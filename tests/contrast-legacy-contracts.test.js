const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const { createDocument } = require('./helpers/contrast-document')

const black = 'rgb(0, 0, 0)', white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
const dark = 'rgb(13, 17, 23)'
const sides = ['top', 'right', 'bottom', 'left']

function fixture(tag = 'div', source = {}) {
    const f = createDocument()
    const target = f.element(tag, f.doc.body, source)
    return { ...f, target }
}

function change(f, source, pseudos = f.target.pseudos) {
    f.target.source = source
    f.target.pseudos = pseudos
    f.target.setAttribute('class', String(Number(f.target.getAttribute('class') || 0) + 1))
    f.mutations()
    f.flush()
}

function underline(color = 'rgb(253, 140, 115)', image = 'none') {
    return { content: '""', width: '120px', height: '4px', 'background-color': color, 'background-image': image }
}

function styles(f) {
    return f.doc.querySelectorAll('*').filter(el => el.localName === 'style').flatMap(el => el.sheet.cssRules)
}

function paint(f, target, prop, pseudo = '') {
    let value = f.painted(target, pseudo)[prop]
    for (const rule of styles(f)) {
        const token = rule.selectorText.match(/data-eink-contrast~="([^"]+)"/)?.[1]
        const matches = token && (target.getAttribute('data-eink-contrast') || '').split(' ').includes(token)
        if (matches && rule.selectorText.endsWith(']' + pseudo)) value = rule.style.getPropertyValue(prop) || value
    }
    return value
}

test('legacy 01: document, selection and native text paints retain a complete high-contrast palette', () => {
    const f = fixture('input', { color: white, '-webkit-text-fill-color': white, 'caret-color': white })
    f.doc.documentElement.source = { 'background-color': dark, color: white }
    f.target.pseudos = { '::placeholder': { color: 'rgb(160, 160, 160)' } }
    f.start()
    assert.equal(paint(f, f.doc.documentElement, 'background-color'), '#fff')
    assert.equal(paint(f, f.doc.documentElement, 'color-scheme'), 'light')
    assert.equal(paint(f, f.doc.documentElement, 'scrollbar-color'), '#000 #fff')
    const selection = styles(f).find(rule => rule.selectorText === '::selection')
    assert.ok(selection)
    assert.equal(selection.style.getPropertyValue('color'), '#fff')
    assert.equal(selection.style.getPropertyValue('background-color'), '#000')
    for (const prop of ['color', '-webkit-text-fill-color', 'caret-color', 'accent-color']) assert.equal(paint(f, f.target, prop), '#000')
    assert.equal(paint(f, f.target, 'color', '::placeholder'), '#000')
})

test('legacy 02: transient interaction and persistent selection remain independently legible', () => {
    const f = fixture('button', { color: white, 'background-color': dark })
    f.target.setAttribute('aria-selected', 'true')
    f.start()
    for (const event of ['pointerover', 'pointerdown', 'pointerup', 'pointerout', 'pointercancel']) {
        f.target.hover = event !== 'pointerout' && event !== 'pointercancel'
        f.doc.emit(event, f.target)
        f.flush()
        assert.equal(paint(f, f.target, 'background-color'), '#000')
        assert.equal(paint(f, f.target, 'color'), '#fff')
    }
    f.target.focus = true
    f.doc.emit('focusin', f.target)
    f.flush()
    assert.equal(paint(f, f.target, 'outline-style'), 'solid')
    assert.equal(paint(f, f.target, 'background-color'), '#000')
})

test('legacy 03: ordinary solid, translucent and gradient surfaces whiten without replacing their geometry', () => {
    for (const source of [
        { 'background-color': dark },
        { 'background-color': 'rgba(0, 0, 0, 0.4)' },
        { 'background-image': 'linear-gradient(rgb(20, 20, 20), rgb(40, 40, 40))' }
    ]) {
        const f = fixture('div', { ...source, 'background-position': '8px 16px', 'background-size': '32px 32px', 'background-repeat': 'no-repeat' })
        f.start()
        assert.equal(paint(f, f.target, 'background-color'), '#fff')
        if (source['background-image']) assert.equal(paint(f, f.target, 'background-image'), 'none')
        for (const prop of ['background-position', 'background-size', 'background-repeat']) assert.equal(paint(f, f.target, prop), f.target.source[prop])
    }
    const f = fixture()
    f.start()
    assert.equal(paint(f, f.target, 'background-color'), clear)
})

test('legacy 04: converting a border never fabricates a background on a transparent element', () => {
    const f = fixture('div', { 'border-top-width': '1px', 'border-top-color': white })
    f.start()
    assert.equal(paint(f, f.target, 'border-top-color'), '#000')
    assert.equal(paint(f, f.target, 'background-color'), clear)
})

test('legacy 05: initially open shadow content converts and restores within its own root', () => {
    const f = fixture('section')
    const root = f.shadow(f.target)
    const inner = f.element('div', null, { 'background-color': dark, color: white })
    root.appendChild(inner)
    f.start()
    assert.equal(f.painted(inner)['background-color'], '#fff')
    assert.equal(f.painted(inner).color, '#000')
    assert.ok(root.children.some(el => el.localName === 'style'))
    f.engine.stop()
    assert.equal(f.painted(inner)['background-color'], dark)
    assert.equal(f.painted(inner).color, white)
    assert.equal(root.children.filter(el => el.localName === 'style').length, 0)
})

test('legacy 06: a pseudo tab underline stays visible without adding a host background', () => {
    const f = fixture('button')
    f.target.pseudos = { '::after': underline() }
    f.start()
    assert.equal(paint(f, f.target, 'background-color', '::after'), '#000')
    assert.equal(paint(f, f.target, 'background-color'), clear)
    assert.equal(paint(f, f.target, 'height', '::after'), '4px')
})

test('legacy 07: pseudo photos and sprites retain images, source color and image geometry', () => {
    for (const size of [24, 160]) {
        const f = fixture('button')
        const image = 'url("icon.png")'
        f.target.pseudos = { '::before': { content: '""', width: size + 'px', height: size + 'px', 'background-image': image,
            'background-color': dark, 'background-position': '8px 16px', 'background-size': '32px 32px' } }
        f.start()
        assert.equal(paint(f, f.target, 'background-image', '::before'), image)
        assert.equal(paint(f, f.target, 'background-color', '::before'), dark)
        assert.equal(paint(f, f.target, 'background-position', '::before'), '8px 16px')
        assert.equal(paint(f, f.target, 'background-size', '::before'), '32px 32px')
    }
})

test('legacy 08: faint decorative pseudo washes do not become opaque black marks', () => {
    const f = fixture()
    f.target.pseudos = { '::after': { content: '""', width: '120px', height: '32px', 'background-color': 'rgba(0, 0, 0, 0.05)' } }
    f.start()
    assert.notEqual(paint(f, f.target, 'background-color', '::after'), '#000')
    change(f, {}, { '::after': underline('rgba(253, 140, 115, 0.5)') })
    assert.equal(paint(f, f.target, 'background-color', '::after'), '#000')
})

test('legacy 09: a pseudo image becoming a solid indicator is converted after mutation', () => {
    const f = fixture('button')
    f.target.pseudos = { '::after': underline(clear, 'url("icon.png")') }
    f.start()
    change(f, {}, { '::after': underline() })
    assert.equal(paint(f, f.target, 'background-color', '::after'), '#000')
    assert.equal(paint(f, f.target, 'background-image', '::after'), 'none')
})

test('legacy 10: solid pseudo paint releases its override when an image replaces the indicator', () => {
    const f = fixture('button')
    f.target.pseudos = { '::after': underline() }
    f.start()
    assert.equal(paint(f, f.target, 'background-color', '::after'), '#000')
    change(f, {}, { '::after': underline(clear, 'url("icon.png")') })
    assert.equal(paint(f, f.target, 'background-color', '::after'), clear)
    assert.equal(paint(f, f.target, 'background-image', '::after'), 'url("icon.png")')
})

test('legacy 11: clear and content-less pseudos never acquire visible paint', () => {
    for (const content of ['none', 'normal', '""']) {
        const f = fixture()
        f.target.pseudos = { '::before': { content, 'background-color': content === '""' ? clear : dark } }
        f.start()
        const tokenRules = styles(f).filter(rule => rule.selectorText.endsWith('::before'))
        if (content === '""') assert.equal(paint(f, f.target, 'background-color', '::before'), clear)
        else assert.equal(tokenRules.length, 0)
    }
})

test('legacy 12: an inset hairline retains translucency, position and inset through DOM conversion', () => {
    const f = fixture('nav', { 'box-shadow': 'rgba(209, 217, 224, 0.7) 0px -1px 0px 0px inset' })
    f.start()
    assert.equal(paint(f, f.target, 'box-shadow'), 'rgba(0, 0, 0, 0.7) 0px -1px 0px 0px inset')
})

test('legacy 13: important glyph paint and editable caret pair with the converted surface', () => {
    const f = fixture('textarea', { 'background-color': dark, color: white, '-webkit-text-fill-color': white, 'caret-color': white })
    f.target.style.setProperty('color', white, 'important')
    f.target.style.setProperty('-webkit-text-fill-color', white, 'important')
    f.start()
    for (const prop of ['color', '-webkit-text-fill-color', 'caret-color']) assert.equal(paint(f, f.target, prop), '#000')
    f.engine.stop()
    assert.equal(paint(f, f.target, 'color'), white)
    assert.equal(f.target.style.getPropertyPriority('color'), 'important')
})

test('legacy 14: media and native forms skip before and after reads while placeholders remain available', () => {
    const f = fixture()
    const reads = []
    for (const tag of ['img', 'video', 'canvas', 'iframe', 'object', 'embed', 'input', 'textarea', 'select', 'div']) {
        const target = f.element(tag, f.doc.body)
        target.pseudos = new Proxy({}, { get(_, name) { reads.push([tag, name]); return { content: 'none' } } })
    }
    f.start()
    for (const tag of ['img', 'video', 'canvas', 'iframe', 'object', 'embed', 'input', 'textarea', 'select']) {
        assert.equal(reads.filter(([t, p]) => t === tag && ['::before', '::after'].includes(p)).length, 0, tag)
    }
    for (const name of ['::before', '::after']) assert.ok(reads.some(([t, p]) => t === 'div' && p === name))
    assert.ok(reads.some(([t, p]) => t === 'input' && p === '::placeholder'))
})

test('legacy 15: SVG root, monochrome shapes and none paints remain visible without touching definitions', () => {
    const f = fixture('svg', { fill: white })
    f.target.namespaceURI = 'http://www.w3.org/2000/svg'
    const path = f.element('path', f.target, { fill: white, stroke: white })
    path.namespaceURI = f.target.namespaceURI
    path.ownerSVGElement = f.target
    const defs = f.element('defs', f.target, { fill: white })
    defs.namespaceURI = f.target.namespaceURI
    f.start()
    assert.equal(paint(f, f.target, 'fill'), '#000')
    assert.equal(paint(f, path, 'fill'), '#000')
    assert.equal(paint(f, path, 'stroke'), '#000')
    assert.equal(defs.getAttribute('data-eink-contrast'), null)
    path.source = { fill: 'none', stroke: clear }
    path.setAttribute('class', 'clear'); f.mutations(); f.flush()
    assert.equal(paint(f, path, 'fill'), 'none')
    assert.equal(paint(f, path, 'stroke'), clear)
})

test('legacy 16: class churn removes stale ordinary surface paint and reconverts new paint', () => {
    const f = fixture('div', { 'background-color': dark })
    f.start()
    assert.equal(paint(f, f.target, 'background-color'), '#fff')
    change(f, {})
    assert.equal(paint(f, f.target, 'background-color'), clear)
    change(f, { 'background-color': dark })
    assert.equal(paint(f, f.target, 'background-color'), '#fff')
})

test('legacy 17: native checked changes transfer the label state and remove the previous paint', () => {
    const f = fixture('input')
    f.target.type = 'checkbox'; f.target.checked = false
    const label = f.element('label', f.doc.body)
    label.control = f.target
    f.start()
    f.target.checked = true
    label.source = { color: white, 'background-color': dark }
    f.doc.emit('change', f.target); f.flush()
    assert.equal(paint(f, label, 'background-color'), '#000')
    assert.equal(paint(f, label, 'color'), '#fff')
    f.target.checked = false; label.source = {}
    f.doc.emit('input', f.target); f.flush()
    assert.equal(paint(f, label, 'background-color'), clear)
})

test('legacy 18: pseudo deselection removes old paint and allows later reselection', () => {
    const f = fixture('button')
    f.target.pseudos = { '::after': underline() }
    f.start()
    assert.equal(paint(f, f.target, 'background-color', '::after'), '#000')
    change(f, {}, { '::after': underline(clear) })
    assert.equal(paint(f, f.target, 'background-color', '::after'), clear)
    change(f, {}, { '::after': underline() })
    assert.equal(paint(f, f.target, 'background-color', '::after'), '#000')
})

test('legacy 19: an unannounced late pseudo sprite survives previous solid conversion', () => {
    const f = fixture('button')
    f.target.pseudos = { '::before': underline() }
    f.start()
    f.target.pseudos = { '::before': { ...underline(clear, 'url("compose.png")'), 'background-position': '8px 16px', 'background-size': '32px 32px' } }
    f.tick(); f.flush()
    assert.equal(paint(f, f.target, 'background-color', '::before'), clear)
    assert.equal(paint(f, f.target, 'background-image', '::before'), 'url("compose.png")')
    assert.equal(paint(f, f.target, 'background-position', '::before'), '8px 16px')
    assert.equal(paint(f, f.target, 'background-size', '::before'), '32px 32px')
})

test('legacy 20: each opaque border side converts without changing width or style', () => {
    const source = Object.fromEntries(sides.flatMap((side, i) => [
        [`border-${side}-color`, i === 2 ? 'rgb(51, 51, 51)' : white],
        [`border-${side}-width`, i === 2 ? '8px' : '1px'], [`border-${side}-style`, i % 2 ? 'dashed' : 'solid']
    ]))
    const f = fixture('div', source)
    f.start()
    for (const side of sides) {
        assert.equal(paint(f, f.target, `border-${side}-color`), '#000')
        for (const prop of ['width', 'style']) assert.equal(paint(f, f.target, `border-${side}-${prop}`), source[`border-${side}-${prop}`])
    }
})

test('legacy 21: transparent spacing borders retain transparency and their original width', () => {
    const f = fixture('div', { 'border-top-width': '1px', 'border-top-color': white,
        'border-bottom-width': '8px', 'border-bottom-color': clear, 'border-bottom-style': 'solid' })
    f.start()
    assert.equal(paint(f, f.target, 'border-top-color'), '#000')
    assert.equal(paint(f, f.target, 'border-bottom-color'), clear)
    assert.equal(paint(f, f.target, 'border-bottom-width'), '8px')
    assert.equal(paint(f, f.target, 'background-color'), clear)
})

test('legacy 22: faint decorative border paint is not promoted into an opaque boundary', () => {
    const f = fixture('div', { 'border-top-width': '1px', 'border-top-color': 'rgba(255, 255, 255, 0.05)',
        'border-bottom-width': '1px', 'border-bottom-color': 'rgba(255, 255, 255, 0.6)' })
    f.start()
    const top = paint(f, f.target, 'border-top-color')
    assert.ok(C.parseColor(top).a <= 0.05, 'Decorative border opacity must not increase')
    assert.equal(paint(f, f.target, 'border-bottom-color'), '#000')
})

test('legacy 23: zero-width borders do not acquire conversion paint or layout changes', () => {
    const f = fixture('div', { 'border-top-width': '0px', 'border-top-color': white, 'border-left-width': '0px', 'border-left-color': white })
    f.start()
    for (const side of ['top', 'left']) {
        assert.equal(paint(f, f.target, `border-${side}-color`), white)
        assert.equal(paint(f, f.target, `border-${side}-width`), '0px')
    }
})

test('legacy 24: one finite initial sweep respects batch bounds and has a single scheduled continuation', () => {
    const f = createDocument({ batchSize: 2 })
    for (let i = 0; i < 5; i++) f.element('div', f.doc.body, { 'border-top-width': '1px', 'border-top-color': white })
    const reads = [], events = []
    const originalNodes = f.doc.querySelectorAll('*')
    for (const [index, el] of originalNodes.entries()) {
        let authored = el.source
        Object.defineProperty(el, 'source', {
            get() { reads.push(index + ':main'); events.push('read'); return authored },
            set(value) { authored = value }
        })
        el.pseudos = new Proxy({}, { get(_, name) { reads.push(index + ':' + name); events.push('read'); return { content: 'none' } } })
    }
    f.engine.start(f.doc)
    for (const el of f.doc.querySelectorAll('*').filter(node => node.localName === 'style')) {
        const insert = el.sheet.insertRule.bind(el.sheet)
        el.sheet.insertRule = (...args) => { events.push('write'); return insert(...args) }
    }
    assert.equal(f.frames.length, 1)
    let frames = 0
    while (f.frames.length) {
        assert.ok(++frames <= 32, 'The initial sweep must finish')
        const before = reads.length
        events.length = 0
        f.frames.shift()()
        assert.ok(reads.length - before <= 12, 'Preflight and snapshot reads must respect the frame budget')
        if (events.includes('write')) assert.ok(events.lastIndexOf('read') < events.indexOf('write'), 'All source reads precede paint-rule insertion')
        assert.ok(f.frames.length <= 1, 'Only one continuation may be scheduled')
    }
    const counts = new Map()
    for (const read of reads) counts.set(read, (counts.get(read) || 0) + 1)
    for (const [read, count] of counts) assert.ok(count <= 2, read + ' may have one preflight and one snapshot')
    assert.ok(reads.length <= originalNodes.length * 6)
    assert.ok(f.engine.stats().transactions <= Math.ceil(originalNodes.length / 2) + 1)
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})

test('legacy 25: inserted subtrees convert while skipped document and SVG definition tags remain untouched', () => {
    const f = fixture()
    f.start()
    const added = f.element('section', f.doc.body, { 'border-top-width': '1px', 'border-top-color': white })
    const child = f.element('p', added, { 'border-top-width': '1px', 'border-top-color': white })
    const skipped = ['script', 'style', 'link', 'meta', 'title', 'base', 'noscript', 'template'].map(tag => f.element(tag, added))
    f.mutations(); f.flush()
    assert.equal(paint(f, added, 'border-top-color'), '#000')
    assert.equal(paint(f, child, 'border-top-color'), '#000')
    for (const node of skipped) assert.equal(node.getAttribute('data-eink-contrast'), null, node.localName)
})

test('legacy 26: repeated discovery and unchanged resampling produce no duplicate paint writes', () => {
    const f = fixture('div', { 'border-top-width': '1px', 'border-top-color': white })
    f.start()
    const writes = f.engine.stats().writes
    for (let i = 0; i < 16; i++) { f.tick(); f.flush() }
    assert.equal(f.engine.stats().writes, writes)
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})

test('legacy 27: shadow conversion preserves alpha, geometry, layers and existing black paints', () => {
    const shadows = [
        ['rgb(59, 130, 246) 0px 4px 8px 0px', '#000 0px 4px 8px 0px'],
        ['rgba(59, 130, 246, 0.3) 0px 4px 8px 0px', 'rgba(0, 0, 0, 0.3) 0px 4px 8px 0px'],
        ['rgba(0, 0, 0, 0.1) 0px 1px 3px 0px', 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px'],
        ['rgb(255, 0, 0) 0px 4px 8px 0px, rgb(0, 0, 0) 0px 1px 2px 0px inset', '#000 0px 4px 8px 0px, rgb(0, 0, 0) 0px 1px 2px 0px inset'],
        ['none', 'none']
    ]
    for (const [source, expected] of shadows) {
        const f = fixture('div', { 'box-shadow': source })
        f.start()
        assert.equal(paint(f, f.target, 'box-shadow'), expected)
    }
})

test('legacy 28: border and shadow conversion coexist without adding a background or changing geometry', () => {
    const f = fixture('div', { 'border-top-width': '1px', 'border-top-color': white,
        'box-shadow': 'rgb(59, 130, 246) 0px 4px 8px 0px' })
    f.start()
    assert.equal(paint(f, f.target, 'border-top-color'), '#000')
    assert.equal(paint(f, f.target, 'border-top-width'), '1px')
    assert.equal(paint(f, f.target, 'box-shadow'), '#000 0px 4px 8px 0px')
    assert.equal(paint(f, f.target, 'background-color'), clear)
})

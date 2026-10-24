const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const Policy = require('../src/high-contrast/contrast')
const { createDocument } = require('./helpers/contrast-document')

const black = 'rgb(0, 0, 0)', white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
function record(tag, parent, style = {}, extra = {}) {
    return { node: {}, tag, parent: parent?.node || null, selected: false, hasText: true, hasChildren: false,
        rect: { left: 0, top: 0, width: 120, height: 32 }, shape: tag, pseudos: {},
        style: { color: white, '-webkit-text-fill-color': white, 'background-color': clear, 'background-image': 'none',
            display: 'block', visibility: 'visible', position: 'static', opacity: '1', fill: 'none', stroke: 'none',
            filter: 'none', 'mix-blend-mode': 'normal', ...style }, ...extra }
}
const props = (plans, r) => plans.get(r.node).rules[''] || {}

for (const [property, value, neutral] of [['filter', 'invert(1)', 'none'], ['filter', 'brightness(0.4)', 'none'],
    ['mix-blend-mode', 'difference', 'normal']]) {
    test(`${property}:${value} on an ordinary toolbar cannot preserve a dark region`, () => {
        const root = record('html', null, { 'background-color': black })
        const toolbar = record('header', root, { 'background-color': black, [property]: value }, { hasChildren: true })
        toolbar.rect.width = 1024
        const label = record('span', toolbar)
        const plans = Policy.createPlanner(C).plan([root, toolbar, label])
        assert.equal(plans.get(toolbar.node).protected, false)
        assert.equal(plans.get(label.node).protected, false)
        assert.equal(props(plans, toolbar)['background-color'], '#fff')
        assert.equal(props(plans, toolbar)[property], neutral)
        assert.equal(props(plans, label).color, '#000')
    })
}

test('real image and multicolor SVG retain their original compositing effects', () => {
    const root = record('html', null, { 'background-color': black })
    const photo = record('section', root, { 'background-image': 'url("photo.png")', filter: 'brightness(0.7)', 'mix-blend-mode': 'screen' })
    const caption = record('span', photo)
    const svg = record('svg', root, { filter: 'blur(0.5px)' }, { svg: true, hasChildren: true })
    const paths = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)'].map(fill =>
        record('path', svg, { fill }, { svg: true, svgRoot: svg.node }))
    const plans = Policy.createPlanner(C).plan([root, photo, caption, svg, ...paths])
    for (const r of [photo, caption, svg, ...paths]) {
        assert.equal(plans.get(r.node).protected, true)
        assert.equal(props(plans, r).filter, undefined)
        assert.equal(props(plans, r)['mix-blend-mode'], undefined)
    }
})

function multicolorNavigation() {
    const root = record('html', null, { 'background-color': black })
    const nav = record('nav', root, { 'background-color': black }, { hasChildren: true })
    const controls = ['rgb(30,0,0)', 'rgb(0,60,0)', 'rgb(0,0,90)', 'rgb(120,120,0)', 'rgb(0,150,150)', 'rgb(180,0,180)']
        .map((background, index) => record('button', nav, { 'background-color': background }, { rect: { left: 0, top: index * 40, width: 120, height: 32 } }))
    controls[4].selected = true
    return { root, nav, controls, records: [root, nav, ...controls] }
}

test('more than four UI colors still convert to white surfaces and a paired selected state', () => {
    const f = multicolorNavigation(), plans = Policy.createPlanner(C).plan(f.records)
    for (const r of [f.root, f.nav, ...f.controls]) assert.equal(plans.get(r.node).protected, false)
    for (const control of f.controls) {
        assert.equal(props(plans, control)['background-color'], control.selected ? '#000' : '#fff')
        assert.equal(props(plans, control).color, control.selected ? '#fff' : '#000')
    }
})

test('selected state transfers after a multicolor group exceeded the visual palette', () => {
    const f = multicolorNavigation(), planner = Policy.createPlanner(C)
    planner.plan(f.records)
    f.controls[4].selected = false
    f.controls[1].selected = true
    const plans = planner.plan([...f.records].reverse())
    for (const control of f.controls) {
        assert.equal(props(plans, control)['background-color'], control.selected ? '#000' : '#fff')
        assert.equal(props(plans, control).color, control.selected ? '#fff' : '#000')
    }
})

test('ordinary toolbar effects are neutralized while active and restored with current authored values', () => {
    const f = createDocument()
    const toolbar = f.element('header', f.doc.body, { 'background-color': black, color: white, filter: 'invert(1)', 'mix-blend-mode': 'difference' })
    toolbar.rect.width = 1024
    toolbar.style.setProperty('filter', 'invert(1)', 'important')
    f.start()
    assert.equal(f.painted(toolbar)['background-color'], '#fff')
    assert.equal(f.painted(toolbar).filter, 'none')
    assert.equal(f.painted(toolbar)['mix-blend-mode'], 'normal')
    toolbar.style.setProperty('filter', 'brightness(0.5)', 'important')
    toolbar.source['mix-blend-mode'] = 'multiply'
    f.mutations(); f.flush()
    assert.equal(f.painted(toolbar).filter, 'none')
    assert.equal(f.painted(toolbar)['mix-blend-mode'], 'normal')
    f.engine.stop()
    assert.equal(toolbar.style.getPropertyValue('filter'), 'brightness(0.5)')
    assert.equal(toolbar.style.getPropertyPriority('filter'), 'important')
    assert.equal(f.painted(toolbar)['mix-blend-mode'], 'multiply')
})

test('a multicolor group without semantic selection converts every ordinary control to white and black', () => {
    const f = multicolorNavigation()
    for (const control of f.controls) control.selected = false
    const plans = Policy.createPlanner(C).plan(f.records)
    for (const control of f.controls) {
        assert.equal(plans.get(control.node).protected, false)
        assert.equal(props(plans, control)['background-color'], '#fff')
        assert.equal(props(plans, control).color, '#000')
    }
})

test('crossing the visual palette limit and returning cannot retain an obsolete selected fill', () => {
    const f = multicolorNavigation(), planner = Policy.createPlanner(C)
    f.controls[4].selected = false
    f.controls[0].selected = true
    const pair = [f.root, f.nav, ...f.controls.slice(0, 2)]
    planner.plan(pair)
    f.controls[0].selected = false
    f.controls[4].selected = true
    assert.equal(props(planner.plan(f.records), f.controls[4])['background-color'], '#000')
    for (const control of f.controls) {
        control.selected = false
        control.style['background-color'] = black
    }
    const plans = planner.plan(pair)
    for (const control of f.controls.slice(0, 2)) {
        assert.equal(plans.get(control.node).protected, false)
        assert.equal(props(plans, control)['background-color'], '#fff')
        assert.equal(props(plans, control).color, '#000')
    }
})

test('a generated ordinary label cannot invert the converted black and white paint', () => {
    const root = record('html', null, { 'background-color': black })
    const label = record('span', root)
    label.pseudos['::before'] = { content: '"Status"', color: white, 'background-color': black,
        filter: 'invert(1)', 'mix-blend-mode': 'difference' }
    const plans = Policy.createPlanner(C).plan([root, label])
    const generated = plans.get(label.node).rules['::before']
    assert.equal(generated['background-color'], '#fff')
    assert.equal(generated.color, '#000')
    assert.equal(generated.filter, 'none')
    assert.equal(generated['mix-blend-mode'], 'normal')
})

test('an unsafe opaque child cannot exempt the document or its ordinary siblings', () => {
    for (const containerTag of ['body', 'main']) {
        const root = record('html', null, { 'background-color': black })
        const body = record('body', root, { 'background-color': black }, { hasChildren: true })
        const container = containerTag === 'body' ? body : record(containerTag, body, { 'background-color': black }, { hasChildren: true })
        const custom = record('custom-control', container, { 'background-color': black }, { unsafe: true })
        const customLabel = record('span', custom)
        const ordinary = record('p', container, { 'background-color': black })
        const records = container === body ? [root, body, custom, customLabel, ordinary] : [root, body, container, custom, customLabel, ordinary]
        const plans = Policy.createPlanner(C).plan(records)
        for (const r of new Set([root, body, container, ordinary])) {
            assert.equal(plans.get(r.node).protected, false)
            assert.equal(props(plans, r)['background-color'], '#fff')
            assert.equal(props(plans, r).color, '#000')
        }
        for (const r of [custom, customLabel]) {
            assert.equal(plans.get(r.node).protected, true)
            assert.deepEqual(props(plans, r), {})
        }
    }
})

test('a color change on repeated noninteractive body content cannot turn it into a black selected surface', () => {
    for (const count of [20, 1000]) {
        const root = record('html', null, { 'background-color': white })
        const article = record('article', root, { 'background-color': white }, { hasChildren: true })
        const rows = Array.from({ length: count }, (_, i) => record('div', article,
            { 'background-color': white, color: black, '-webkit-text-fill-color': black },
            { rect: { left: 0, top: i * 40, width: 320, height: 32 } }))
        const planner = Policy.createPlanner(C), records = [root, article, ...rows]
        planner.plan(records)
        Object.assign(rows.at(-1).style, { 'background-color': black, color: white, '-webkit-text-fill-color': white })
        const plans = planner.plan(records)
        assert.equal(plans.get(rows.at(-1).node).protected, false)
        assert.equal(props(plans, rows.at(-1))['background-color'], '#fff')
        assert.equal(props(plans, rows.at(-1)).color, '#000')
        assert.equal(props(plans, rows.at(-1))['-webkit-text-fill-color'], '#000')
    }
})

test('visual selection without ARIA keeps black fill for links buttons and focusable controls', () => {
    for (const extra of [{ tag: 'a' }, { tag: 'button' }, { tag: 'div', focusable: true }]) {
        const root = record('html', null, { 'background-color': white })
        const nav = record('nav', root, {}, { hasChildren: true })
        const plain = record(extra.tag, nav, { color: black, '-webkit-text-fill-color': black }, extra)
        const active = record(extra.tag, nav, { 'background-color': black }, { ...extra,
            rect: { left: 0, top: 40, width: 120, height: 32 } })
        const plans = Policy.createPlanner(C).plan([root, nav, plain, active])
        assert.equal(props(plans, active)['background-color'], '#000')
        assert.equal(props(plans, active).color, '#fff')
    }
})

test('an explicit selected state can retain black fill on a noninteractive row', () => {
    const root = record('html', null, { 'background-color': white })
    const selected = record('div', root, { 'background-color': black }, { selected: true })
    const plans = Policy.createPlanner(C).plan([root, selected])
    assert.equal(props(plans, selected)['background-color'], '#000')
    assert.equal(props(plans, selected).color, '#fff')
})

test('a small positioned background icon cannot protect ordinary text or its parent surface', () => {
    for (const [width, height] of [[12, 8], [42, 42]]) {
        const root = record('html', null, { 'background-color': black })
        const panel = record('section', root, { 'background-color': black, position: 'relative' },
            { hasChildren: true, rect: { left: 0, top: 0, width: 350, height: 80 } })
        const icon = record('i', panel, { 'background-image': 'url("icon.png")', position: 'absolute' },
            { hasText: false, rect: { left: 0, top: 0, width, height } })
        const text = record('p', panel, {}, { rect: { left: 0, top: 0, width: 350, height: 58 } })
        const plans = Policy.createPlanner(C).plan([root, panel, icon, text])
        assert.equal(plans.get(panel.node).protected, false)
        assert.equal(plans.get(text.node).protected, false)
        assert.equal(props(plans, panel)['background-color'], '#fff')
        assert.equal(props(plans, text).color, '#000')
        assert.equal(plans.get(icon.node).protected, true)
    }
})

test('a local positioned background image protects only its positioned overlay text', () => {
    const root = record('html', null, { 'background-color': black })
    const card = record('section', root, { 'background-color': black, position: 'relative' },
        { hasChildren: true, rect: { left: 0, top: 0, width: 350, height: 160 } })
    const photo = record('div', card, { 'background-image': 'url("photo.png")', position: 'absolute' },
        { hasText: false, rect: { left: 0, top: 0, width: 350, height: 80 } })
    const overlay = record('strong', card, { position: 'absolute' })
    const caption = record('p', card, {}, { rect: { left: 0, top: 80, width: 350, height: 40 } })
    const plans = Policy.createPlanner(C).plan([root, card, photo, overlay, caption])
    assert.equal(plans.get(card.node).protected, false)
    assert.equal(plans.get(photo.node).protected, true)
    assert.equal(plans.get(overlay.node).protected, true)
    assert.equal(props(plans, overlay)['background-color'], undefined)
    assert.equal(plans.get(caption.node).protected, false)
    assert.equal(props(plans, caption).color, '#000')
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

const white = 'rgb(255, 255, 255)'

test('periodic reconciliation does not rediscover an already observed shadow subtree', () => {
    const f = createDocument(), host = f.element('section', f.doc.body), shadow = f.shadow(host)
    shadow.appendChild(f.element('span', null))
    const query = shadow.querySelectorAll
    let queries = 0
    shadow.querySelectorAll = (...args) => { queries++; return query(...args) }
    f.start()
    queries = 0
    f.tick(); f.flush()
    assert.equal(queries, 0)
    assert.equal(f.engine.stats().roots, 2)
})

test('removing a shadow host releases every shadow descendant and its inline ownership', () => {
    const f = createDocument()
    f.start()
    const baseline = f.engine.stats().nodes
    const host = f.element('section', f.doc.body), shadow = f.shadow(host)
    const button = f.element('button', null), text = f.element('span', null)
    button.style.setProperty('color', white, 'important')
    shadow.appendChild(button); shadow.appendChild(text)
    f.mutations(); f.flush()
    assert.equal(f.engine.stats().nodes, baseline + 3)
    assert.equal(f.engine.stats().inline, 1)
    host.remove()
    f.mutations(); f.flush()
    assert.equal(f.engine.stats().roots, 1)
    assert.equal(f.engine.stats().nodes, baseline)
    assert.equal(f.engine.stats().inline, 0)
    assert.equal(button.style.getPropertyValue('color'), white)
    assert.equal(button.style.getPropertyPriority('color'), 'important')
    assert.equal(f.engine.stats().pending, 0)
})

test('a local multicolor SVG update preserves protection derived from other graphic branches', () => {
    const f = createDocument(), svg = f.element('svg', f.doc.body, { fill: 'none' })
    svg.namespaceURI = 'http://www.w3.org/2000/svg'; svg.textContent = ''
    const paths = ['rgb(220, 0, 0)', 'rgb(0, 220, 0)', 'rgb(0, 0, 220)'].map((fill, i) => {
        const group = f.element('g', svg, { fill: 'none' })
        group.namespaceURI = svg.namespaceURI; group.ownerSVGElement = svg; group.textContent = ''
        group.rect.left = i * 40
        const element = f.element('path', group, { fill })
        element.namespaceURI = svg.namespaceURI; element.ownerSVGElement = svg; element.textContent = ''
        element.rect.left = i * 40
        return element
    })
    f.start()
    assert.deepEqual(paths.map(el => f.painted(el).fill), paths.map(el => el.source.fill))
    paths[0].source.fill = 'rgb(240, 0, 0)'
    paths[0].setAttribute('data-value', 'changed')
    f.mutations(); f.flush()
    assert.deepEqual(paths.map(el => f.painted(el).fill), paths.map(el => el.source.fill))
    assert.equal(f.engine.stats().failures, 0)
})

test('a local photo-card text update keeps protection derived from its positioned heading sibling', () => {
    const f = createDocument(), card = f.element('article', f.doc.body, {
        color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(8, 8, 8)', position: 'relative'
    })
    card.rect = { width: 400, height: 240, left: 0, top: 0 }
    const image = f.element('img', card)
    image.rect = { ...card.rect }; image.textContent = ''
    const title = f.element('h2', card, { color: white, '-webkit-text-fill-color': white, position: 'absolute' })
    title.rect = { width: 240, height: 32, left: 16, top: 160 }
    const detail = f.element('p', card, { color: white, '-webkit-text-fill-color': white, position: 'relative' })
    detail.rect = { width: 320, height: 64, left: 16, top: 16 }
    f.start()
    assert.equal(f.painted(detail).color, white)
    detail.source.color = 'rgb(240, 240, 240)'
    detail.source['-webkit-text-fill-color'] = 'rgb(240, 240, 240)'
    detail.setAttribute('data-content', 'changed')
    f.mutations(); f.flush()
    assert.equal(f.painted(card)['background-color'], 'rgb(8, 8, 8)')
    assert.equal(f.painted(detail).color, 'rgb(240, 240, 240)')
    assert.equal(f.engine.stats().failures, 0)
})

test('a shadow-root radio click resamples native peers outside the document name collection', () => {
    const f = createDocument(), host = f.element('section', f.doc.body), shadow = f.shadow(host)
    const group = f.element('fieldset', null)
    shadow.appendChild(group)
    const selected = { color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(32, 40, 90)' }
    const idle = { color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)' }
    const a = f.element('label', group, selected), b = f.element('label', group, idle)
    const first = f.element('input', a), second = f.element('input', b)
    first.type = second.type = 'radio'; first.name = second.name = 'choice'
    first.checked = true; second.checked = false
    first.labels = [a]; second.labels = [b]; a.control = first; b.control = second
    f.doc.getElementsByName = name => f.doc.querySelectorAll('*').filter(el => el.name === name)
    f.start()
    first.checked = false; second.checked = true
    a.source = idle; b.source = selected
    shadow.emit('click', second)
    f.flush()
    assert.equal(f.painted(a)['background-color'], 'rgba(0, 0, 0, 0)')
    assert.equal(f.painted(b)['background-color'], '#000')
    assert.equal(f.painted(b)['box-shadow'], 'none')
    assert.equal(f.engine.stats().failures, 0)
})

test('periodic sampling restores a removed shadow-root base stylesheet without requiring changed source paint', () => {
    const f = createDocument(), host = f.element('section', f.doc.body), shadow = f.shadow(host)
    shadow.appendChild(f.element('button', null))
    f.start()
    const base = shadow.querySelectorAll('*').find(el => el.localName === 'style'
        && el.sheet.cssRules.some(rule => rule.selectorText === ':root'))
    assert.ok(base)
    base.remove()
    f.mutations(); f.tick(); f.flush()
    assert.equal(base.isConnected, true)
    assert.ok(base.sheet.cssRules.some(rule => rule.selectorText === '::-webkit-scrollbar-thumb'))
    assert.equal(f.engine.stats().pending, 0)
})

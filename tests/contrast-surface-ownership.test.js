const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')
const clear = 'rgba(0, 0, 0, 0)'
function sidebar(pseudo = {}) {
    const f = createDocument()
    const nav = f.element('nav', f.doc.body)
    const buttons = Array.from({ length: 4 }, (_, i) => {
        const button = f.element('button', nav)
        button.rect = { left: 0, top: i * 48, width: 40, height: 40 }
        button.textContent = ''
        const icon = f.element('svg', button)
        icon.textContent = ''
        icon.namespaceURI = 'http://www.w3.org/2000/svg'
        f.element('path', icon, { fill: 'rgb(143, 143, 143)' }).textContent = ''
        button.pseudos = { '::before': { content: '""', width: '40px', height: '40px',
            'background-color': 'rgba(0, 0, 0, 0.05)', opacity: '0', ...pseudo } }
        return button
    })
    return { ...f, buttons }
}
function noContainerPaint(f, el) {
    assert.equal(f.painted(el)['background-color'], clear)
    assert.equal(f.painted(el)['box-shadow'], 'none')
    assert.equal(f.painted(el)['outline-style'], 'none')
}
for (const invisible of [{ opacity: '0' }, { opacity: '1', display: 'none' }, { opacity: '1', visibility: 'hidden' }]) {
    test(`invisible pseudo surface ${JSON.stringify(invisible)} never creates a sidebar button background`, () => {
        const f = sidebar(invisible)
        f.start()
        for (const button of f.buttons) noContainerPaint(f, button)
    })
}

test('a visible pseudo surface stays on the pseudo instead of becoming host paint', () => {
    const f = sidebar()
    f.buttons[0].pseudos['::before'].opacity = '1'
    f.buttons[0].pseudos['::before']['background-color'] = 'rgb(32, 40, 90)'
    f.start()
    assert.equal(f.painted(f.buttons[0])['background-color'], clear)
    assert.equal(f.painted(f.buttons[0], '::before')['background-color'], '#000')
    assert.equal(f.painted(f.buttons[0]).color, '#fff')
    for (const button of f.buttons.slice(1)) noContainerPaint(f, button)
    f.buttons[0].pseudos['::before'].opacity = '0'
    f.engine.invalidate(f.buttons[0]); f.flush()
    noContainerPaint(f, f.buttons[0])
    assert.match(f.painted(f.buttons[0]).color, /^(#000|rgb\(0, 0, 0\))$/)
})

for (const pseudo of [false, true]) test(`an unpainted ${pseudo ? 'pseudo' : 'element'} mask does not acquire ink`, () => {
    const f = createDocument(), el = f.element('button', f.doc.body)
    el.textContent = ''
    const mask = { 'mask-image': 'url("icon.svg")', 'background-color': clear }
    if (pseudo) el.pseudos = { '::before': { ...mask, content: '""', width: '16px', height: '16px' } }
    else Object.assign(el.source, mask)
    f.start()
    assert.equal(f.painted(el, pseudo ? '::before' : '')['background-color'], clear)
})

for (const selected of [false, true]) test(`transparent backdrop-only control retains transparency with selected=${selected}`, () => {
    const f = createDocument(), el = f.element('button', f.doc.body, { 'backdrop-filter': 'blur(8px)' })
    if (selected) el.setAttribute('aria-pressed', 'true')
    f.start()
    assert.equal(f.painted(el)['background-color'], clear)
    assert.equal(f.painted(el)['backdrop-filter'], 'none')
    if (selected) assert.match(f.painted(el)['box-shadow'], /inset/)
})

test('adding an identical unselected peer cannot turn an ordinary button from black to white', () => {
    const f = createDocument(), nav = f.element('nav', f.doc.body)
    const source = { 'background-color': 'rgb(225, 230, 240)' }
    const el = f.element('button', nav, { ...source })
    f.start()
    assert.equal(f.painted(el)['background-color'], '#fff')
    const before = { background: f.painted(el)['background-color'], shadow: f.painted(el)['box-shadow'] }
    const peer = f.element('button', nav, { ...source })
    peer.rect.top = 48
    f.mutations(); f.flush()
    assert.deepEqual({ background: f.painted(el)['background-color'], shadow: f.painted(el)['box-shadow'] }, before)
})

test('a visible faint full-size pseudo keeps coordinated ink without painting its transparent host', () => {
    const f = sidebar()
    f.buttons[0].pseudos['::before'].opacity = '1'
    f.start()
    assert.equal(f.painted(f.buttons[0])['background-color'], clear)
    assert.equal(f.painted(f.buttons[0], '::before')['background-color'], '#000')
    assert.equal(f.painted(f.buttons[0]).color, '#fff')
})

for (const opacity of ['0.05', '0.5']) test(`a selected pseudo at opacity ${opacity} keeps effective surface and glyph contrast paired`, () => {
    const f = sidebar()
    Object.assign(f.buttons[0].pseudos['::before'], { opacity, 'background-color': 'rgb(0, 0, 0)' })
    f.start()
    assert.equal(f.painted(f.buttons[0])['background-color'], clear)
    assert.equal(f.painted(f.buttons[0], '::before')['background-color'], '#000')
    assert.equal(f.painted(f.buttons[0], '::before').opacity, '1')
    assert.equal(f.painted(f.buttons[0]).color, '#fff')
})

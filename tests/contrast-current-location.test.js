const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

const white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
function brand() {
    const f = createDocument()
    f.doc.body.source = { 'background-color': 'rgb(13, 13, 17)', color: white }
    const nav = f.element('nav', f.doc.body)
    const link = f.element('a', nav, { color: white, '-webkit-text-fill-color': white, 'background-color': clear })
    link.setAttribute('href', '/')
    link.setAttribute('aria-current', 'page')
    link.rect = { left: 0, top: 0, width: 160, height: 32 }
    const icon = f.element('img', link)
    icon.rect = { left: 0, top: 0, width: 32, height: 32 }
    const text = f.element('span', link, { color: white, '-webkit-text-fill-color': white })
    const peers = f.element('div', nav)
    f.element('a', peers)
    return { ...f, link, icon, text }
}

test('a current-page home link does not gain an invented selected frame around its brand', () => {
    const f = brand()
    f.start()
    assert.equal(f.painted(f.link)['box-shadow'], 'none')
    assert.equal(f.painted(f.link)['outline-style'], 'none')
    assert.equal(f.painted(f.link)['background-color'], clear)
    assert.equal(f.painted(f.link).color, '#000')
    assert.equal(f.painted(f.text).color, '#000')
    assert.equal(f.link.getAttribute('aria-current'), 'page')
    assert.equal(f.engine.stats().failures, 0)
})

test('current location does not suppress an explicit selected state or keyboard focus', () => {
    const f = brand()
    f.link.setAttribute('aria-selected', 'true')
    f.start()
    assert.match(f.painted(f.link)['box-shadow'], /inset/)
    f.link.removeAttribute('aria-selected')
    f.mutations(); f.flush()
    assert.equal(f.painted(f.link)['box-shadow'], 'none')
    f.link.focus = true
    f.doc.emit('focusin', f.link); f.flush()
    assert.equal(f.painted(f.link)['outline-style'], 'solid')
})

test('authored current-page navigation paint remains distinct and follows location changes', () => {
    const f = createDocument()
    const nav = f.element('nav', f.doc.body)
    const active = { color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(32, 40, 90)' }
    const idle = { color: 'rgb(0,0,0)', 'background-color': clear }
    const a = f.element('a', nav, { ...active }), b = f.element('a', nav, { ...idle })
    a.setAttribute('aria-current', 'page')
    b.rect.left = 160
    f.start()
    assert.equal(f.painted(a)['background-color'], '#000')
    assert.equal(f.painted(a).color, '#fff')
    a.removeAttribute('aria-current'); b.setAttribute('aria-current', 'page')
    a.source = { ...idle }; b.source = { ...active }
    f.mutations(); f.flush()
    assert.equal(f.painted(a)['background-color'], clear)
    assert.equal(f.painted(b)['background-color'], '#000')
    assert.equal(f.painted(b).color, '#fff')
})

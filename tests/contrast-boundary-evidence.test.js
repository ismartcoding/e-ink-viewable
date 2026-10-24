const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

const white = 'rgb(255, 255, 255)', black = 'rgb(0, 0, 0)', clear = 'rgba(0, 0, 0, 0)'
function fixture() {
    const f = createDocument()
    const nav = f.element('nav', f.doc.body)
    const link = f.element('a', nav, { color: black, 'background-color': clear })
    link.setAttribute('href', '/repository')
    const peer = f.element('button', nav, { color: black, 'background-color': clear })
    peer.rect.left = 160
    return { ...f, nav, link, peer }
}
function noFrame(f, el) {
    assert.equal(f.painted(el)['box-shadow'], 'none')
    assert.equal(f.painted(el)['outline-style'], 'none')
}

for (const background of [white, 'rgba(255, 255, 255, 0.4)']) test(`an ordinary action painted ${background} on white does not acquire a boundary`, () => {
    const f = fixture()
    f.link.source['background-color'] = background
    f.start()
    noFrame(f, f.link)
})

test('a current breadcrumb next to a differently colored repository picker does not acquire a frame', () => {
    const f = fixture()
    f.link.setAttribute('aria-current', 'page')
    f.link.setAttribute('data-status', 'active')
    f.link.source.color = 'rgb(35, 40, 45)'
    f.peer.source.color = 'rgb(90, 95, 100)'
    f.start()
    noFrame(f, f.link)
    noFrame(f, f.peer)
    assert.equal(f.painted(f.link).color, '#000')
})

test('foreground-only navigation distinctions use text paint without inventing a container edge', () => {
    const f = fixture()
    f.link.source.color = 'rgb(0, 0, 255)'
    f.start()
    noFrame(f, f.link)
    noFrame(f, f.peer)
    assert.notDeepEqual(f.painted(f.link)['text-decoration-style'], f.painted(f.peer)['text-decoration-style'])
})

test('explicit selection and focus retain separate cues and release them when cleared', () => {
    const f = fixture()
    f.link.setAttribute('aria-selected', 'true')
    f.start()
    assert.match(f.painted(f.link)['box-shadow'], /inset/)
    f.link.removeAttribute('aria-selected')
    f.mutations(); f.flush()
    noFrame(f, f.link)
    f.link.focus = true
    f.doc.emit('focusin', f.link); f.flush()
    assert.equal(f.painted(f.link)['outline-style'], 'solid')
    f.link.focus = false
    f.doc.emit('focusout', f.link); f.flush()
    noFrame(f, f.link)
})

test('authored container edges retain their geometry without accumulating synthetic edges', () => {
    const f = fixture()
    Object.assign(f.link.source, { 'background-color': white, 'border-top-width': '1px',
        'border-top-style': 'solid', 'border-top-color': 'rgb(90, 95, 100)',
        'box-shadow': '0px 1px 3px rgb(90, 95, 100)' })
    f.start()
    const paint = f.painted(f.link)
    assert.equal(paint['border-top-width'], '1px')
    assert.equal(paint['border-top-color'], '#000')
    assert.doesNotMatch(paint['box-shadow'], /inset|2px/)
    assert.equal(paint['outline-style'], 'none')
})

test('uniform tinted controls retain a real surface boundary when whitening would erase it', () => {
    const f = fixture()
    f.link.source['background-color'] = f.peer.source['background-color'] = 'rgb(225, 230, 240)'
    f.start()
    for (const el of [f.link, f.peer]) {
        assert.equal(f.painted(el)['background-color'], '#fff')
        assert.match(f.painted(el)['box-shadow'], /inset/)
    }
})

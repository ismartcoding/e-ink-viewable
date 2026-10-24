const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

const white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
const idle = () => ({ color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': clear })
const selected = () => ({ color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(32, 40, 90)' })
function menu(options) {
    const f = createDocument(options)
    const nav = f.element('nav', f.doc.body)
    const a = f.element('button', nav, selected()), b = f.element('button', nav, idle())
    a.setAttribute('aria-selected', 'true')
    b.rect.top = 40
    return { ...f, a, b }
}
function switchTo(f, target) {
    for (const el of [f.a, f.b]) {
        el.source = el === target ? selected() : idle()
        el.setAttribute('aria-selected', String(el === target))
    }
    f.doc.emit('click', target)
    f.flush()
}

test('DOM conversion follows 64 real state changes without stale selected paint or source edits', () => {
    const f = menu()
    f.start()
    const authored = f.a.getAttribute('style')
    for (let i = 0; i < 64; i++) {
        const active = i % 2 ? f.a : f.b, old = i % 2 ? f.b : f.a
        switchTo(f, active)
        assert.equal(f.painted(active)['background-color'], '#000')
        assert.equal(f.painted(active).color, '#fff')
        assert.equal(f.painted(old)['background-color'], clear)
        assert.match(f.painted(old).color, /^(#000|rgb\(0, 0, 0\))$/)
        assert.equal(f.engine.stats().pending, 0)
        assert.equal(f.engine.stats().failures, 0)
    }
    assert.equal(f.a.getAttribute('style'), authored)
    f.engine.stop()
    assert.equal(f.painted(f.a)['background-color'], 'rgb(32, 40, 90)')
    assert.equal(f.painted(f.a).color, white)
})

test('periodic checks discover a late shadow root and schedule its new nodes', () => {
    const f = menu()
    f.start()
    const host = f.element('section', f.doc.body)
    f.mutations(); f.flush()
    const root = f.shadow(host)
    const a = f.element('button', null, selected()), b = f.element('button', null, idle())
    root.appendChild(a); root.appendChild(b)
    a.setAttribute('aria-selected', 'true')
    f.tick()
    assert.ok(f.frames.length > 0)
    f.flush()
    assert.equal(f.painted(a)['background-color'], '#000')
    assert.equal(f.engine.stats().pending, 0)
    host.remove(); f.mutations(); f.flush()
    assert.equal(f.engine.stats().roots, 1)
})

test('a native radio click resamples the deselected peer label before planning the group', () => {
    const f = createDocument()
    const group = f.element('fieldset', f.doc.body)
    const a = f.element('label', group, selected()), b = f.element('label', group, idle())
    const first = f.element('input', a), second = f.element('input', b)
    first.type = second.type = 'radio'
    first.name = second.name = 'choice'
    first.checked = true; second.checked = false
    a.control = first; b.control = second
    f.start()
    first.checked = false; second.checked = true
    a.source = idle(); b.source = selected()
    f.doc.emit('click', second)
    f.flush()
    assert.equal(f.painted(b)['background-color'], '#000')
    assert.equal(f.painted(a)['background-color'], clear)
    assert.equal(f.painted(b)['box-shadow'], 'none')
})

test('periodic ticks during every batch never refill completed background work', () => {
    const f = menu({ batchSize: 16 })
    for (let i = 0; i < 1000; i++) f.element('span', f.doc.body)
    f.engine.start(f.doc)
    let turns = 0
    while (f.frames.length) {
        assert.ok(++turns < 20 * Math.ceil(f.engine.stats().nodes / 16) + 32, 'Periodic checks must allow a finite sweep to finish')
        f.tick()
        f.frames.shift()()
        assert.ok(f.engine.stats().guardPasses <= 2, 'One sweep must not recompile guards after each periodic tick')
    }
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
    assert.ok(f.engine.stats().rules < 32)
})

test('unannounced native control state and CSSOM changes reconcile on the next periodic sweep', () => {
    const f = menu()
    const input = f.element('input', f.doc.body)
    input.type = 'checkbox'; input.checked = false
    const label = f.element('label', f.doc.body, idle())
    label.control = input
    f.start()
    input.checked = true
    label.source = selected()
    f.tick(); f.flush()
    assert.equal(f.painted(label)['background-color'], '#000')
    input.checked = false
    label.source = idle()
    f.tick(); f.flush()
    assert.equal(f.painted(label)['background-color'], clear)
    f.b.source = { ...idle(), 'background-color': 'rgb(200, 200, 200)' }
    f.tick(); f.flush()
    assert.equal(f.painted(f.b)['background-color'], '#fff')
})

test('hidden documents defer work and visibility change resumes pending conversion', () => {
    const f = menu()
    f.doc.hidden = true
    f.engine.start(f.doc)
    assert.equal(f.frames.length, 0)
    assert.equal(f.a.getAttribute('style'), null)
    f.doc.hidden = false
    f.doc.emit('visibilitychange')
    f.flush()
    assert.equal(f.painted(f.a)['background-color'], '#000')
    assert.equal(f.engine.stats().pending, 0)
})

test('stop restores hooks and important author styles and cancels queued callbacks', () => {
    const f = menu()
    f.a.setAttribute('data-eink-contrast', 'author')
    f.a.style.setProperty('color', white, 'important')
    f.start()
    f.a.style.setProperty('color', 'rgb(222, 222, 222)', 'important')
    f.a.style.setProperty('border-radius', '8px')
    f.engine.invalidate(f.a)
    f.engine.stop()
    f.flush()
    assert.equal(f.a.getAttribute('data-eink-contrast'), 'author')
    assert.equal(f.a.style.getPropertyValue('color'), 'rgb(222, 222, 222)')
    assert.equal(f.a.style.getPropertyPriority('color'), 'important')
    assert.equal(f.a.style.getPropertyValue('border-radius'), '8px')
    assert.equal(f.engine.stats().rules, 0)
    assert.equal(f.cancelled(), 1)
    f.start()
    assert.equal(f.engine.stats().failures, 0)
    assert.equal(f.painted(f.a)['background-color'], '#000')
})

test('removing extension style layers and hooks is repaired on the next periodic check', () => {
    const f = menu()
    f.start()
    for (const style of f.doc.querySelectorAll('*').filter(e => e.localName === 'style')) style.remove()
    f.a.removeAttribute('data-eink-contrast')
    f.tick(); f.flush()
    assert.equal(f.painted(f.a)['background-color'], '#000')
    assert.equal(f.painted(f.a).color, '#fff')
})

test('focus and ancestor-dependent source changes replan without converting layout properties', () => {
    const f = menu()
    f.start()
    f.b.focus = true
    f.b.source = { ...idle(), 'background-color': 'rgb(100, 120, 140)', transform: 'translateX(8px)' }
    f.doc.body.setAttribute('data-theme', 'changed')
    f.doc.emit('focusin', f.b)
    f.flush()
    assert.equal(f.painted(f.b)['outline-style'], 'solid')
    assert.equal(f.painted(f.b)['outline-offset'], '4px')
    assert.equal(f.painted(f.b).transform, 'translateX(8px)')
    f.b.focus = false; f.b.source = idle()
    f.doc.emit('focusout', f.b); f.flush()
    assert.equal(f.painted(f.b)['outline-style'], 'none')
    assert.equal(f.painted(f.b)['background-color'], clear)
})

test('starting on a dark long page with a fixed background canvas still converts actual article text', () => {
    const f = menu()
    f.doc.body.source = { color: white, 'background-color': 'rgb(11, 16, 14)' }
    f.doc.body.rect = { width: 1024, height: 4000, left: 0, top: 0 }
    const canvas = f.element('canvas', f.doc.body, { position: 'fixed' })
    canvas.textContent = ''; canvas.rect = { width: 1024, height: 768, left: 0, top: 0 }
    const skip = f.element('a', f.doc.body, { position: 'absolute', color: white })
    skip.rect.top = -1000
    const main = f.element('main', f.doc.body)
    const title = f.element('h2', main, { color: white, '-webkit-text-fill-color': white })
    f.start()
    assert.equal(f.painted(f.doc.body)['background-color'], '#fff')
    assert.equal(f.painted(title).color, '#000')
    switchTo(f, f.b)
    assert.equal(f.painted(f.b)['background-color'], '#000')
    assert.equal(f.painted(f.a)['background-color'], clear)
    f.engine.stop()
    assert.equal(f.painted(f.doc.body)['background-color'], 'rgb(11, 16, 14)')
    assert.equal(f.painted(title).color, white)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

const white = 'rgb(255, 255, 255)'
const black = 'rgb(0, 0, 0)'
const content = () => ({ color: 'rgb(128, 128, 128)', '-webkit-text-fill-color': 'rgb(128, 128, 128)', 'background-color': 'rgb(230, 230, 230)' })

function page(size = 20, batchSize = 192) {
    const f = createPerformanceDocument({ batchSize })
    const article = f.element('article', f.doc.body)
    const rows = Array.from({ length: size }, () => f.element('p', article, content()))
    return { ...f, rows }
}

test('initial ordinary source reads are shared with transition preflight instead of repeated', () => {
    const f = page(1000)
    f.start()
    assert.ok(f.rows.every(el => f.readsFor(el) === 3), 'Each ordinary element needs one main and two pseudo reads')
    assert.ok(f.rows.every(el => f.painted(el).color === '#000'))
    assert.equal(f.engine.stats().failures, 0)
})

test('author class style and subtree changes replace samples taken earlier in the initial sweep', () => {
    const f = page(20, 4), changed = f.rows[0]
    f.engine.start(f.doc)
    f.frames.shift()()
    assert.equal(f.readsFor(changed), 3)
    changed.source = { color: white, '-webkit-text-fill-color': white, 'background-color': black }
    changed.setAttribute('class', 'author-changed')
    changed.style.setProperty('color', 'rgb(96, 96, 96)', 'important')
    const child = f.element('span', changed, { color: white, '-webkit-text-fill-color': white, 'background-color': black })
    f.mutations(); f.flush()
    assert.ok(f.readsFor(changed) >= 6)
    assert.equal(f.painted(changed).color, '#000')
    assert.equal(f.painted(changed)['background-color'], '#fff')
    assert.equal(f.painted(child).color, '#000')
    assert.equal(f.painted(child)['background-color'], '#fff')
    assert.equal(f.engine.stats().pending, 0)
    f.engine.stop()
    assert.equal(changed.style.getPropertyValue('color'), 'rgb(96, 96, 96)')
    assert.equal(changed.style.getPropertyPriority('color'), 'important')
})

test('the complete initial transition guard precedes paint and guarded nodes still get fresh source reads', () => {
    const f = page(20, 4), guarded = f.rows.at(-1)
    Object.assign(guarded.source, { 'transition-property': 'color, transform', 'transition-duration': '1s' })
    f.engine.start(f.doc)
    let painted = false
    let guardedReads = 0, ordinaryReads = 0
    for (let i = 0; f.frames.length; i++) {
        assert.ok(i < 200)
        f.resetCounts()
        f.frames.shift()()
        guardedReads += f.readsFor(guarded)
        ordinaryReads += f.readsFor(f.rows[0])
        assert.ok(f.counts().hookWrites <= 4)
        if (f.rows.some(el => /\bp\d+\b/.test(el.getAttribute('data-eink-contrast') || ''))) {
            assert.match(guarded.getAttribute('data-eink-contrast'), /\bt\d+\b/)
            painted = true
        }
    }
    assert.equal(painted, true)
    assert.equal(guardedReads, 6)
    assert.equal(ordinaryReads, 3)
    assert.equal(f.painted(guarded).color, '#000')
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})

test('source sharing stops once initial rendering has started and extension paint exists', () => {
    const f = page(20, 4), changed = f.rows[0]
    f.engine.start(f.doc)
    for (let i = 0; !/\bp\d+\b/.test(changed.getAttribute('data-eink-contrast') || ''); i++) {
        assert.ok(i < 200 && f.frames.length)
        f.frames.shift()()
    }
    f.resetCounts()
    Object.assign(changed.source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(128, 0, 0)' })
    changed.setAttribute('class', 'changed-during-render')
    f.mutations(); f.flush()
    assert.ok(f.readsFor(changed) >= 6, 'Existing extension paint requires suspended source sampling')
    assert.equal(f.painted(changed)['outline-color'], '#000')
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})

for (const change of ['insert', 'edit']) {
    test(`an author stylesheet ${change} refreshes nodes sampled earlier in the initial sweep`, () => {
        const f = page(20, 4), changed = f.rows[0]
        const stylesheet = change === 'edit' ? f.element('style', f.doc.documentElement) : null
        f.engine.start(f.doc)
        f.frames.shift()()
        Object.assign(changed.source, { color: white, '-webkit-text-fill-color': white,
            'background-image': 'url("photo.png")' })
        if (stylesheet) stylesheet.setAttribute('media', 'screen')
        else f.element('style', f.doc.documentElement)
        f.mutations(); f.flush()
        assert.ok(f.readsFor(changed) >= 6)
        assert.equal(f.painted(changed).color, white)
        assert.equal(f.engine.stats().pending, 0)
        assert.equal(f.engine.stats().failures, 0)
    })
}

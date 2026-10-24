const test = require('node:test')
const assert = require('node:assert/strict')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

test('a page without paint transitions never toggles an empty guard stylesheet', () => {
    const f = createPerformanceDocument()
    const text = f.element('p', f.doc.body, { color: 'rgb(80, 80, 80)' })
    f.start()
    assert.equal(f.counts().sheetToggles, 0)
    f.resetCounts()
    text.source.color = 'rgb(100, 100, 100)'
    f.engine.invalidate(text); f.flush()
    assert.equal(f.painted(text).color, '#000')
    assert.equal(f.counts().sheetToggles, 0)
})

test('local ordinary content does not toggle an unrelated shadow transition guard', () => {
    const f = createPerformanceDocument()
    const text = f.element('p', f.doc.body, { color: 'rgb(80, 80, 80)' })
    const host = f.element('section', f.doc.body), root = f.shadow(host)
    const control = f.element('button', null, { color: 'rgb(80, 80, 80)', 'transition-property': 'color', 'transition-duration': '1s' })
    root.appendChild(control)
    f.start()
    assert.ok(f.engine.stats().guardPlans > 0)
    f.resetCounts()
    text.source.color = 'rgb(100, 100, 100)'
    f.engine.invalidate(text); f.flush()
    assert.equal(f.painted(text).color, '#000')
    assert.equal(f.counts().sheetToggles, 0)
})

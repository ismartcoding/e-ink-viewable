const test = require('node:test')
const assert = require('node:assert/strict')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

const black = 'rgb(0, 0, 0)'
const white = 'rgb(255, 255, 255)'
const clear = 'rgba(0, 0, 0, 0)'

test('native radio selection transfers across separate containers without resampling ordinary content', () => {
    const f = createPerformanceDocument()
    const resting = () => ({ color: black, '-webkit-text-fill-color': black, 'background-color': clear })
    const selected = () => ({ color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(32, 40, 90)' })
    const article = f.element('article', f.doc.body)
    const ordinary = Array.from({ length: 20 }, () => f.element('div', article, { ...resting(), 'background-color': white }))
    const firstGroup = f.element('section', f.doc.body), secondGroup = f.element('section', f.doc.body)
    const firstLabel = f.element('label', firstGroup, selected()), secondLabel = f.element('label', secondGroup, resting())
    const first = f.element('input', firstLabel), second = f.element('input', secondLabel)
    first.type = second.type = 'radio'; first.name = second.name = 'shared-choice'
    first.form = second.form = f.element('form', f.doc.body)
    first.checked = true; second.checked = false
    firstLabel.control = first; secondLabel.control = second
    f.start()
    assert.equal(f.painted(firstLabel)['background-color'], '#000')
    first.checked = false; second.checked = true
    firstLabel.source = resting(); secondLabel.source = selected()
    f.resetCounts()
    f.doc.emit('click', second)
    f.flush()
    assert.equal(f.painted(firstLabel)['background-color'], clear)
    assert.equal(f.painted(secondLabel)['background-color'], '#000')
    assert.equal(f.painted(secondLabel).color, '#fff')
    assert.equal(ordinary.reduce((sum, el) => sum + f.readsFor(el), 0), 0)
    assert.equal(ordinary.reduce((sum, el) => sum + f.plannedFor(el), 0), 0)
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})

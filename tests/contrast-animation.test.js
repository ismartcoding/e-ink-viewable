const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

test('an ordinary color animation does not exempt the page from high contrast', () => {
    const f = createDocument()
    f.doc.body.source = { color: 'rgb(220, 220, 220)', 'background-color': 'rgb(20, 20, 20)' }
    const text = f.element('p', f.doc.body, { color: 'rgb(220, 220, 220)' })
    f.doc.getAnimations = () => [{ playState: 'running', effect: { target: f.doc.body,
        getKeyframes: () => [{ backgroundColor: 'rgb(20, 20, 20)' }, { backgroundColor: 'rgb(40, 40, 40)' }] } }]
    f.start()
    assert.equal(f.painted(f.doc.body)['background-color'], '#fff')
    assert.equal(f.painted(text).color, '#000')
    f.engine.stop()
    assert.equal(f.painted(f.doc.body)['background-color'], 'rgb(20, 20, 20)')
})

test('local paint updates do not enumerate every animation in the document', () => {
    const f = createDocument()
    const button = f.element('button', f.doc.body, { color: 'rgb(30, 30, 30)' })
    let enumerations = 0
    f.doc.getAnimations = () => { enumerations++; return [] }
    f.start()
    enumerations = 0
    button.source.color = 'rgb(50, 50, 50)'
    f.engine.invalidate(button); f.flush()
    assert.equal(enumerations, 0)
    assert.equal(f.painted(button).color, '#000')
})

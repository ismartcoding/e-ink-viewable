const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

test('pending work stays visible between shared sampling and the first paint plan', () => {
    const f = createDocument({ batchSize: 10 })
    for (let i = 0; i < 18; i++) f.element('p', f.doc.body, { color: 'rgb(80, 80, 80)' })
    f.engine.start(f.doc)
    let turns = 0
    while (f.frames.length) {
        assert.ok(++turns < 200)
        assert.ok(f.engine.stats().pending > 0, 'A scheduled conversion must not report an empty work queue')
        f.frames.shift()()
    }
    assert.equal(f.engine.stats().pending, 0)
})

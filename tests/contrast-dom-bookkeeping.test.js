const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

test('local sampling does not assemble all descendant text of document ancestors', () => {
    const f = createDocument()
    const changed = f.element('p', f.doc.body)
    for (let i = 0; i < 1000; i++) f.element('div', f.doc.body)
    let aggregateReads = 0
    Object.defineProperty(f.doc.body, 'textContent', { get: () => { aggregateReads++; return 'All descendant text' } })
    f.doc.createTreeWalker = () => ({ nextNode: () => ({ nodeValue: 'First text' }) })
    f.start()
    aggregateReads = 0
    changed.source.color = 'rgb(40, 40, 40)'
    f.engine.invalidate(changed); f.flush()
    assert.equal(f.painted(changed).color, '#000')
    assert.equal(aggregateReads, 0)
})

test('a bounded shape signature does not iterate every child of a large ancestor', () => {
    const f = createDocument()
    const changed = f.element('p', f.doc.body)
    for (let i = 0; i < 1000; i++) f.element('div', f.doc.body)
    f.start()
    let childrenVisited = 0
    const children = f.doc.body.children
    f.doc.body.children = new Proxy(children, { get(target, key, receiver) {
        if (key === Symbol.iterator) return function* () { for (const child of target) { childrenVisited++; yield child } }
        return Reflect.get(target, key, receiver)
    } })
    changed.source.color = 'rgb(40, 40, 40)'
    f.engine.invalidate(changed); f.flush()
    assert.equal(f.painted(changed).color, '#000')
    assert.ok(childrenVisited <= 8, `Visited ${childrenVisited} children while sampling one content row`)
})

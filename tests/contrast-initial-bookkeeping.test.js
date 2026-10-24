const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const Dom = require('../src/contrast-dom')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

function page(size = 400) {
    const work = { snapshotSerializations: 0, snapshotCharacters: 0, sourceEntryPairs: 0, leafWalkers: 0 }
    const measuredObject = new Proxy(Object, { get(target, key) {
        if (key !== 'fromEntries') return Reflect.get(target, key)
        return entries => {
            const value = Object.fromEntries(entries)
            work.sourceEntryPairs += Object.keys(value).length
            return value
        }
    } })
    const context = { module: { exports: {} }, Object: measuredObject, JSON: { parse: JSON.parse,
        stringify(value, ...args) {
            const text = JSON.stringify(value, ...args)
            if (value?.style && value?.pseudos && value?.rect) {
                work.snapshotSerializations++
                work.snapshotCharacters += text.length
            }
            return text
        } }, require: name => {
        assert.equal(name, './contrast-output.js')
        return require('../src/contrast-output')
    } }
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/contrast-dom'), 'utf8'), context)
    const original = Dom.createContrastEngine
    Dom.createContrastEngine = context.module.exports.createContrastEngine
    let f
    try { f = createPerformanceDocument() }
    finally { Dom.createContrastEngine = original }
    const rows = Array.from({ length: size }, () => f.element('div', f.doc.body, {
        color: 'rgb(128, 128, 128)', '-webkit-text-fill-color': 'rgb(128, 128, 128)', 'background-color': 'rgb(230, 230, 230)'
    }))
    const leaves = new Set(rows)
    for (const row of rows) row.firstChild = { nodeType: 3, nodeValue: 'Ordinary content' }
    f.doc.createTreeWalker = el => {
        if (leaves.has(el)) work.leafWalkers++
        let visited = false
        return { nextNode() {
            if (visited) return null
            visited = true
            return { nodeType: 3, nodeValue: 'Ordinary content' }
        } }
    }
    return { ...f, rows, work }
}

test('initial and unchanged source samples do not serialize retained snapshot copies', t => {
    const f = page()
    f.start()
    t.diagnostic(JSON.stringify(f.work))
    assert.equal(f.work.snapshotSerializations, 0)
    assert.equal(f.work.snapshotCharacters, 0)
    f.resetCounts()
    f.tick(); f.flush()
    assert.equal(f.work.snapshotSerializations, 0)
    assert.equal(f.counts().planCalls, 0)
    assert.equal(f.engine.stats().failures, 0)
})

test('copying computed source properties does not allocate an entry pair for every property', t => {
    const f = page()
    f.start()
    t.diagnostic(JSON.stringify(f.work))
    assert.equal(f.work.sourceEntryPairs, 0)
    assert.ok(f.rows.every(el => f.painted(el).color === '#000'))
    assert.ok(f.rows.every(el => f.painted(el)['background-color'] === '#fff'))
})

test('text-only leaves do not construct a TreeWalker for their first nonempty text node', t => {
    const f = page()
    f.start()
    t.diagnostic(JSON.stringify(f.work))
    assert.equal(f.work.leafWalkers, 0)
    assert.equal(f.engine.stats().failures, 0)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const Dom = require('../src/contrast-dom')
const { createDocument } = require('./helpers/contrast-document')

test('a local selection update does not copy the full page plan cache', () => {
    let copied = 0
    class CountedMap extends Map {
        constructor(iterable) {
            super(iterable)
            if (iterable instanceof CountedMap && iterable.size >= 1000) copied += iterable.size
        }
    }
    const context = { module: { exports: {} }, Map: CountedMap, require: name => {
        assert.equal(name, './contrast-output.js')
        return require('../src/contrast-output')
    } }
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/contrast-dom'), 'utf8'), context)
    const original = Dom.createContrastEngine
    Dom.createContrastEngine = context.module.exports.createContrastEngine
    let f
    try { f = createDocument() }
    finally { Dom.createContrastEngine = original }
    const nav = f.element('nav', f.doc.body)
    const first = f.element('button', nav, { color: 'rgb(255, 255, 255)', 'background-color': 'rgb(20, 30, 40)' })
    const second = f.element('button', nav, { color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)' })
    first.setAttribute('aria-selected', 'true')
    second.rect.top = 40
    for (let i = 0; i < 1000; i++) f.element('p', f.doc.body)
    f.start()
    copied = 0
    first.setAttribute('aria-selected', 'false'); second.setAttribute('aria-selected', 'true')
    first.source = { color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)' }
    second.source = { color: 'rgb(255, 255, 255)', 'background-color': 'rgb(20, 30, 40)' }
    f.doc.emit('click', second); f.flush()
    assert.equal(f.painted(second)['background-color'], '#000')
    assert.equal(f.painted(first)['background-color'], 'rgba(0, 0, 0, 0)')
    assert.equal(copied, 0)
})

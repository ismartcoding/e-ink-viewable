const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createDocument } = require('./helpers/contrast-document')

function fixture(count) {
    const f = createDocument(), maps = [], work = { entries: 0, clears: 0 }
    let owners
    class CountedMap extends Map {
        constructor(...args) { super(...args); maps.push(this) }
        *[Symbol.iterator]() { for (const entry of super[Symbol.iterator]()) { if (this === owners) work.entries++; yield entry } }
        *keys() { for (const key of super.keys()) { if (this === owners) work.entries++; yield key } }
        *entries() { for (const entry of super.entries()) { if (this === owners) work.entries++; yield entry } }
        *values() { for (const value of super.values()) { if (this === owners) work.entries++; yield value } }
        forEach(callback, thisArg) { return super.forEach((value, key) => { if (this === owners) work.entries++; callback.call(thisArg, value, key, this) }) }
        clear() { if (this === owners) work.clears++; return super.clear() }
    }
    const context = { module: { exports: {} }, Map: CountedMap }
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/contrast-inline'), 'utf8'), context)
    const inline = context.module.exports.createInlineStyles(f.doc)
    owners = maps[0]
    const elements = Array.from({ length: count }, () => {
        const el = f.element('div', f.doc.body)
        el.style.setProperty('color', 'white', 'important')
        return el
    })
    const plans = new Map(elements.map(el => [el, { rules: { '': { color: '#000' } } }]))
    inline.apply(plans)
    assert.equal(inline.size(), count)
    work.entries = work.clears = 0
    return { inline, elements, plans, work }
}

test('scoped important-style sampling does not enumerate or rebuild unrelated owners', () => {
    const f = fixture(1000), target = f.elements[0], scope = new Set([target])
    f.inline.pause(scope)
    assert.equal(target.style.getPropertyValue('color'), 'white')
    f.inline.apply(f.plans, scope)
    assert.equal(target.style.getPropertyValue('color'), '#000')
    assert.equal(f.work.entries, 0)
    assert.equal(f.work.clears, 0)
    assert.equal(f.inline.size(), 1000)
    assert.ok(f.elements.every(el => el.style.getPropertyValue('color') === '#000'))
    f.inline.clear()
    assert.ok(f.elements.every(el => el.style.getPropertyValue('color') === 'white'))
})

test('scoped plan removal restores that owner without visiting other converted elements', () => {
    const f = fixture(1000), target = f.elements[0]
    f.plans.delete(target)
    f.inline.apply(f.plans, new Set([target]))
    assert.equal(target.style.getPropertyValue('color'), 'white')
    assert.equal(f.work.entries, 0)
    assert.equal(f.work.clears, 0)
    assert.equal(f.inline.size(), 999)
    assert.ok(f.elements.slice(1).every(el => el.style.getPropertyValue('color') === '#000'))
})

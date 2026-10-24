const test = require('node:test')
const assert = require('node:assert/strict')
const { createInlineStyles } = require('../src/contrast-inline.js')

function fixture(initial = 'color:white!important;background-color:black!important') {
    const mutations = []
    function makeElement(initialText = '') {
        let raw = initialText || null
        const values = new Map()
        const el = { localName: 'div', isConnected: true, getAttribute: name => name === 'style' ? raw : null }
        const parse = text => {
            values.clear()
            for (const decl of (text || '').split(';')) {
                const colon = decl.indexOf(':')
                if (colon < 0) continue
                const key = decl.slice(0, colon).trim(), value = decl.slice(colon + 1).trim()
                values.set(key, { value: value.replace(/\s*!important$/, ''), priority: /!important$/.test(value) ? 'important' : '' })
            }
        }
        parse(initialText)
        const write = () => {
            mutations.push({ type: 'attributes', attributeName: 'style', target: el, oldValue: raw })
            raw = [...values].map(([key, entry]) => key + ':' + entry.value + (entry.priority ? '!important' : '')).join(';')
        }
        el.style = {
            getPropertyValue: prop => values.get(prop)?.value || '',
            getPropertyPriority: prop => values.get(prop)?.priority || '',
            setProperty(prop, value, priority = '') { values.set(prop, { value, priority }); write() },
            removeProperty(prop) { values.delete(prop); write() },
            get cssText() { return raw || '' },
            set cssText(text) { parse(text); raw = text }
        }
        return el
    }
    const doc = { createElement: () => makeElement() }
    const el = makeElement(initial)
    const inline = createInlineStyles(doc)
    const plans = new Map([[el, { rules: { '': { color: '#000', 'background-color': '#fff' } } }]])
    const flush = () => inline.readMutations(mutations.splice(0))
    return { el, inline, plans, flush, mutations }
}

test('inline important fallback is removed without losing author priority', () => {
    const f = fixture()
    f.inline.apply(f.plans)
    assert.equal(f.el.style.getPropertyValue('color'), '#000')
    assert.equal(f.flush().size, 2)
    f.inline.clear()
    assert.equal(f.el.style.getPropertyValue('color'), 'white')
    assert.equal(f.el.style.getPropertyPriority('color'), 'important')
    assert.equal(f.el.style.getPropertyValue('background-color'), 'black')
})

test('author changes during conversion become the new restoration state', () => {
    const f = fixture()
    f.inline.apply(f.plans)
    f.flush()
    f.el.style.setProperty('color', 'red', 'important')
    assert.equal(f.flush().size, 0)
    f.inline.pause()
    f.inline.apply(f.plans)
    f.flush()
    assert.equal(f.el.style.getPropertyValue('color'), '#000')
    f.inline.clear()
    assert.equal(f.el.style.getPropertyValue('color'), 'red')
})

test('unrelated author inline changes do not adopt the converted color as source', () => {
    const f = fixture()
    f.inline.apply(f.plans)
    f.flush()
    f.el.style.setProperty('width', '80px')
    f.flush()
    f.inline.pause()
    f.inline.apply(f.plans)
    f.flush()
    f.inline.clear()
    assert.equal(f.el.style.getPropertyValue('color'), 'white')
    assert.equal(f.el.style.getPropertyValue('width'), '80px')
})

test('interleaved own and author mutation records are attributed by their exact transitions', () => {
    const f = fixture()
    f.inline.apply(f.plans)
    f.el.style.setProperty('color', 'yellow', 'important')
    f.el.style.setProperty('width', '80px')
    assert.equal(f.flush().size, 2)
    f.inline.pause()
    f.inline.apply(f.plans)
    f.flush()
    f.inline.clear()
    assert.equal(f.el.style.getPropertyValue('color'), 'yellow')
    assert.equal(f.el.style.getPropertyValue('width'), '80px')
})

test('source sampling sees original values and returns to conversion after every transaction', () => {
    const f = fixture()
    f.inline.apply(f.plans)
    f.flush()
    for (let i = 0; i < 32; i++) {
        f.inline.pause()
        assert.equal(f.el.style.getPropertyValue('color'), 'white')
        f.inline.apply(f.plans)
        assert.equal(f.el.style.getPropertyValue('color'), '#000')
        assert.equal(f.flush().size, 4)
        assert.equal(f.inline.size(), 1)
    }
    f.inline.clear()
    assert.equal(f.inline.size(), 0)
})

test('removed plans restore author values and do not keep ownership', () => {
    const f = fixture()
    f.inline.apply(f.plans)
    f.flush()
    f.inline.pause()
    f.inline.apply(new Map())
    assert.equal(f.el.style.getPropertyValue('color'), 'white')
    assert.equal(f.inline.size(), 0)
})

test('author deletion of an important property is preserved on shutdown', () => {
    const f = fixture()
    f.inline.apply(f.plans)
    f.flush()
    f.el.style.removeProperty('color')
    f.flush()
    f.inline.pause()
    f.inline.apply(f.plans)
    f.flush()
    f.inline.clear()
    assert.equal(f.el.style.getPropertyValue('color'), '')
})

test('reentrant custom elements are left to the protected-region policy', () => {
    const f = fixture()
    f.el.localName = 'custom-control'
    f.inline.apply(f.plans)
    assert.equal(f.inline.size(), 0)
    assert.equal(f.el.style.getPropertyValue('color'), 'white')
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { createDocument } = require('./helpers/contrast-document')

function textDocument() {
    const f = createDocument()
    const observers = []
    const Observer = f.view.MutationObserver
    f.view.MutationObserver = class extends Observer {
        constructor(callback) { super(callback); observers.push(this) }
    }
    let visits = 0
    function text(el, value = ' ') {
        const node = { nodeType: 3, parentElement: el, value }
        Object.defineProperty(node, 'nodeValue', { get() { visits++; return node.value } })
        el.textNode = node
        return node
    }
    function prepare(el) {
        Object.defineProperty(el, 'childNodes', { get: () => [el.textNode, ...el.children].filter(Boolean) })
        text(el)
    }
    prepare(f.doc.documentElement); prepare(f.doc.body)
    f.doc.createTreeWalker = el => {
        const pending = [el], texts = []
        while (pending.length) {
            const node = pending.pop()
            if (node.nodeType === 3) texts.push(node)
            else pending.push(...(node.childNodes || node.children || []))
        }
        let i = 0
        return { nextNode: () => texts[i++] || null }
    }
    const element = (tag, parent) => { const el = f.element(tag, parent); prepare(el); return el }
    const change = (node, value) => {
        node.value = value
        for (const observer of observers) observer.callback([{ type: 'characterData', target: node }])
        f.flush()
    }
    return { ...f, element, text, change, visits: () => visits, resetVisits: () => { visits = 0 } }
}

test('whitespace text discovery visits each text node once across nested snapshots', () => {
    for (const size of [100, 200, 400]) {
        const f = textDocument()
        let parent = f.doc.body
        for (let i = 0; i < size; i++) parent = f.element('div', parent)
        f.start()
        assert.equal(f.visits(), size + 2)
        f.resetVisits(); f.tick(); f.flush()
        assert.equal(f.visits(), 0)
    }
})

test('character data changes refresh cached descendant text and every ancestor', () => {
    const f = textDocument()
    const link = f.element('a', f.doc.body)
    let parent = link
    for (let i = 0; i < 64; i++) parent = f.element('span', parent)
    f.start()
    assert.notEqual(f.painted(link)['text-decoration-line'], 'underline')
    f.change(parent.textNode, 'Visible label')
    assert.equal(f.painted(link)['text-decoration-line'], 'underline')
    f.change(parent.textNode, ' ')
    assert.notEqual(f.painted(link)['text-decoration-line'], 'underline')
})

test('adding and removing nested text invalidates an existing text cache', () => {
    const f = textDocument()
    const link = f.element('a', f.doc.body)
    f.start()
    assert.notEqual(f.painted(link)['text-decoration-line'], 'underline')
    const child = f.element('span')
    child.textNode.value = 'Visible label'
    link.appendChild(child); f.mutations(); f.flush()
    assert.equal(f.painted(link)['text-decoration-line'], 'underline')
    child.remove(); f.mutations(); f.flush()
    assert.notEqual(f.painted(link)['text-decoration-line'], 'underline')
})

test('ordinary repeated text rows retain identical initial and incremental paint', () => {
    const f = createDocument()
    const group = f.element('div', f.doc.body)
    const row = f.element('div', group, { 'background-color': 'rgb(220, 230, 245)' })
    const peer = f.element('div', group)
    row.rect.top = 0; peer.rect.top = 40
    f.start()
    const initial = f.painted(row)['box-shadow']
    assert.equal(initial, 'none')
    row.source.color = 'rgb(10, 10, 10)'; row.setAttribute('class', 'changed')
    f.mutations(); f.flush()
    assert.equal(f.painted(row)['box-shadow'], initial)
})

test('reattaching a subtree refreshes text changed while it was disconnected', () => {
    const f = textDocument()
    const link = f.element('a', f.doc.body)
    const child = f.element('span', link)
    f.start()
    assert.notEqual(f.painted(link)['text-decoration-line'], 'underline')
    child.remove()
    child.textNode.value = 'Visible label'
    link.appendChild(child); f.mutations(); f.flush()
    assert.equal(f.painted(link)['text-decoration-line'], 'underline')
})

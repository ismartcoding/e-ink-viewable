const test = require('node:test')
const assert = require('node:assert/strict')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

const black = 'rgb(0, 0, 0)'
const white = 'rgb(255, 255, 255)'
function contentPage(size, gray = false) {
    const f = createPerformanceDocument()
    const article = f.element('article', f.doc.body)
    const style = () => ({ color: gray ? 'rgb(128, 128, 128)' : black,
        '-webkit-text-fill-color': gray ? 'rgb(128, 128, 128)' : black,
        'background-color': gray ? 'rgb(230, 230, 230)' : white })
    const rows = Array.from({ length: size }, (_, i) => {
        const el = f.element('div', article, style())
        el.rect.top = i * 32
        return el
    })
    f.start()
    return { ...f, article, rows, style }
}

function assertUnrelatedUntouched(f, rows) {
    assert.equal(rows.reduce((sum, row) => sum + f.readsFor(row), 0), 0)
    assert.equal(rows.reduce((sum, row) => sum + f.plannedFor(row), 0), 0)
    assert.equal(rows.reduce((sum, row) => sum + f.inlineWritesFor(row), 0), 0)
    assert.ok(rows.filter(row => f.samplingWritesFor(row) > 0).length < 192)
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
}

for (const gray of [false, true]) {
    test(`one ordinary ${gray ? 'gray' : 'white'} content class change does not process its repeated siblings`, () => {
        const results = []
        for (const size of [20, 1000]) {
            const f = contentPage(size, gray), changed = f.rows.at(-1)
            changed.source = { color: white, '-webkit-text-fill-color': white, 'background-color': black }
            changed.setAttribute('class', 'changed')
            f.resetCounts()
            f.mutations(); f.flush()
            assertUnrelatedUntouched(f, f.rows.slice(0, -1))
            assert.equal(f.painted(changed)['background-color'], '#fff')
            assert.equal(f.painted(changed).color, '#000')
            results.push(f.counts())
        }
        assert.equal(results[1].sourceReads, results[0].sourceReads)
        assert.equal(results[1].plannedRecords, results[0].plannedRecords)
        assert.ok(results[1].plannedRecords <= 4)
    })

    test(`adding a subtree to ${gray ? 'gray' : 'white'} content does not process existing ordinary rows`, () => {
        const results = []
        for (const size of [20, 1000]) {
            const f = contentPage(size, gray)
            const group = f.element('section')
            const added = Array.from({ length: 32 }, () => f.element('div', group, f.style()))
            f.resetCounts()
            f.article.appendChild(group)
            for (const ancestor of [f.article, f.doc.body, f.doc.documentElement]) ancestor.rect.height += 32 * 32
            f.mutations(); f.flush()
            assertUnrelatedUntouched(f, f.rows)
            assert.ok(added.every(el => ['#000', black].includes(f.painted(el).color)))
            assert.ok(added.every(el => ['#fff', white].includes(f.painted(el)['background-color'])))
            results.push(f.counts())
        }
        assert.equal(results[1].sourceReads, results[0].sourceReads)
        assert.equal(results[1].plannedRecords, results[0].plannedRecords)
        assert.ok(results[1].plannedRecords <= 36)
    })
}

test('clicking an ordinary paragraph does not turn its repeated siblings into action peers', () => {
    const f = contentPage(1000), changed = f.rows.at(-1)
    Object.assign(changed.source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(128, 0, 0)' })
    f.resetCounts()
    f.doc.emit('click', changed)
    f.flush()
    assertUnrelatedUntouched(f, f.rows.slice(0, -1))
    assert.equal(f.painted(changed)['outline-color'], '#000')
    assert.ok(f.counts().plannedRecords <= 4)
})

test('nonlocal sibling-selector source changes still converge through bounded reconciliation', () => {
    const f = contentPage(400), changed = f.rows.at(-1), sibling = f.rows[0]
    Object.assign(sibling.source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(128, 0, 0)' })
    changed.setAttribute('class', 'changes-a-distant-sibling')
    f.resetCounts()
    f.mutations(); f.flush()
    assert.equal(f.readsFor(sibling), 0)
    const limit = Math.ceil(f.engine.stats().nodes / 192) * 2 + 2
    let converted = false
    for (let i = 0; i < limit; i++) {
        f.resetCounts()
        f.tick(); f.flush()
        assert.ok(f.counts().sourceReads <= 192 * 6)
        if (f.painted(sibling)['outline-color'] === '#000') { converted = true; break }
    }
    assert.equal(converted, true)
})

test('a structural change that changes parent paint still refreshes its existing descendants', () => {
    const f = contentPage(20), child = f.rows[0]
    f.article.source['background-color'] = 'rgb(128, 128, 128)'
    child.source = { color: white, '-webkit-text-fill-color': white, 'background-color': black }
    const added = f.element('section')
    f.resetCounts()
    f.article.appendChild(added)
    f.mutations(); f.flush()
    assert.ok(f.readsFor(child) > 0)
    assert.equal(f.painted(child)['background-color'], '#fff')
    assert.equal(f.painted(child).color, '#000')
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})


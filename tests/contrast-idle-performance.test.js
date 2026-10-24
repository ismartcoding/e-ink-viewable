const test = require('node:test')
const assert = require('node:assert/strict')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

const white = 'rgb(255, 255, 255)'
const clear = 'rgba(0, 0, 0, 0)'
const normal = () => ({ color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': clear })
const selected = () => ({ color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(32, 40, 90)' })

function idlePage(size = 400) {
    const f = createPerformanceDocument()
    const article = f.element('article', f.doc.body)
    const rows = Array.from({ length: size }, () => f.element('p', article, {
        color: 'rgb(80, 80, 80)', '-webkit-text-fill-color': 'rgb(80, 80, 80)', 'background-color': white
    }))
    return { ...f, rows }
}

function tick(f) {
    f.tick()
    f.flush()
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
}

function stabilize(f) {
    for (let i = 0; i < Math.ceil(f.engine.stats().nodes / 192) * 4 + 4; i++) tick(f)
}

function finishSourceTick(f) {
    for (let i = 0; i < 2; i++) {
        f.resetCounts()
        tick(f)
        if (f.counts().sourceReads) return
    }
    assert.fail('The bounded idle sampler did not run')
}

test('a stable page skips expensive reconciliation on alternate ticks without sampling writes', () => {
    const f = idlePage()
    f.start()
    stabilize(f)
    const records = []
    for (let i = 0; i < 12; i++) {
        f.resetCounts()
        tick(f)
        records.push(f.counts())
    }
    assert.equal(records.filter(record => record.sourceReads === 0).length, 6)
    assert.equal(records.filter(record => record.rectReads === 0).length, 6)
    for (const record of records) {
        assert.ok(record.sourceReads <= 192 * 6)
        assert.ok(record.maxFrameSourceReads <= 192 * 4)
        assert.equal(record.attributeWrites, 0)
        assert.equal(record.inlineWrites, 0)
        assert.equal(record.outputRuleWrites, 0)
        if (!record.sourceReads) {
            assert.equal(record.cssomWrites, 0)
            assert.equal(record.samplingRuleWrites, 0)
            assert.equal(record.sheetToggles, 0)
        }
    }
})

test('unannounced CSSOM paint still converges within two bounded rotations after idle backoff', () => {
    const f = idlePage()
    f.start()
    stabilize(f)
    const changed = f.rows[f.rows.length - 1]
    Object.assign(changed.source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(12, 20, 30)' })
    const limit = Math.ceil(f.engine.stats().nodes / 192) * 2 + 2
    let converted = false
    for (let i = 0; i < limit; i++) {
        f.resetCounts()
        tick(f)
        assert.ok(f.counts().sourceReads <= 192 * 6)
        if (f.painted(changed)['outline-color'] === '#000') { converted = true; break }
    }
    assert.equal(converted, true)
})

test('cheap native-state checks wake a backed-off source sampler on the next tick', () => {
    const f = idlePage(8)
    const group = f.element('fieldset', f.doc.body)
    const label = f.element('label', group, normal())
    const input = f.element('input', label)
    input.type = 'checkbox'; input.checked = false; label.control = input
    f.start()
    stabilize(f)
    for (let i = 0; i < 4; i++) {
        input.checked = !input.checked
        label.source = input.checked ? selected() : normal()
        f.resetCounts()
        tick(f)
        assert.equal(f.painted(label)['background-color'], input.checked ? '#000' : clear)
        assert.ok(f.counts().sourceReads > 0)
        assert.equal(f.rows.reduce((sum, el) => sum + f.readsFor(el), 0), 0)
    }
    stabilize(f)
    finishSourceTick(f)
    input.indeterminate = true
    Object.assign(label.source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(12, 20, 30)' })
    f.resetCounts()
    tick(f)
    assert.equal(f.painted(label)['outline-color'], '#000')
    assert.equal(f.rows.reduce((sum, el) => sum + f.readsFor(el), 0), 0)
})

test('a late shadow root is discovered during a backed-off source tick', () => {
    const f = idlePage(8)
    const host = f.element('section', f.doc.body)
    f.start()
    stabilize(f)
    finishSourceTick(f)
    const shadow = f.shadow(host)
    const label = f.element('button', null, selected())
    shadow.appendChild(label)
    label.setAttribute('aria-selected', 'true')
    tick(f)
    assert.equal(f.engine.stats().roots, 2)
    assert.equal(f.painted(label)['background-color'], '#000')
})

test('a real interaction restores rapid periodic reconciliation after a stable idle period', () => {
    const f = idlePage(8)
    const button = f.element('button', f.doc.body, normal())
    f.start()
    stabilize(f)
    finishSourceTick(f)
    f.doc.emit('pointerover', button)
    f.flush()
    Object.assign(f.rows[0].source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(12, 20, 30)' })
    tick(f)
    assert.equal(f.painted(f.rows[0])['outline-color'], '#000')
})

test('a DOM mutation restores rapid periodic reconciliation after a stable idle period', () => {
    const f = idlePage(8)
    f.start()
    stabilize(f)
    finishSourceTick(f)
    f.rows[0].setAttribute('data-content', 'changed')
    f.mutations(); f.flush()
    Object.assign(f.rows[1].source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(12, 20, 30)' })
    tick(f)
    assert.equal(f.painted(f.rows[1])['outline-color'], '#000')
})

test('hidden idle pages perform neither source reconciliation nor shadow discovery', () => {
    const f = idlePage(8)
    const host = f.element('section', f.doc.body)
    f.start()
    stabilize(f)
    f.doc.hidden = true
    const shadow = f.shadow(host)
    shadow.appendChild(f.element('button', null, selected()))
    f.resetCounts()
    for (let i = 0; i < 4; i++) f.tick()
    assert.equal(f.counts().sourceReads, 0)
    assert.equal(f.counts().rectReads, 0)
    assert.equal(f.counts().queryCalls, 0)
    assert.equal(f.engine.stats().roots, 1)
    assert.equal(f.frames.length, 0)
    f.doc.hidden = false
    f.doc.emit('visibilitychange')
    f.flush()
    tick(f)
    assert.equal(f.engine.stats().roots, 2)
})

test('stopping and restarting clears idle backoff and native-state history', () => {
    const f = idlePage(8)
    f.start()
    stabilize(f)
    f.engine.stop()
    f.start()
    Object.assign(f.rows[0].source, { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'rgb(12, 20, 30)' })
    f.resetCounts()
    tick(f)
    assert.equal(f.painted(f.rows[0])['outline-color'], '#000')
    assert.ok(f.counts().sourceReads > 0)
})

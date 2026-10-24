const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

const white = 'rgb(255, 255, 255)'
const clear = 'rgba(0, 0, 0, 0)'
const normal = () => ({ color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': clear, 'text-shadow': 'none' })
const selected = () => ({ color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(32, 40, 90)' })
const periodicBatch = 192
const parseColor = value => C.parseColor(value === '#000' ? 'rgb(0, 0, 0)' : value === '#fff' ? white : value)
function assertSampling(counts) {
    assert.equal(counts.samplingPauses, counts.samplingResumes)
    assert.equal(counts.samplingRuleWrites, counts.samplingPauses * 2)
    assert.equal(counts.samplingRuleWrites, counts.samplingCssomWrites)
    assert.ok(counts.maxFrameSourceReads <= periodicBatch * 4)
    assert.ok(counts.maxFrameSamplingMembers <= periodicBatch * 2 + 32)
}

function page(size = 1000) {
    const f = createPerformanceDocument()
    const nav = f.element('nav', f.doc.body)
    const first = f.element('button', nav, selected())
    const second = f.element('button', nav, normal())
    first.setAttribute('aria-selected', 'true')
    second.rect.top = 40
    const article = f.element('article', f.doc.body)
    const ordinary = Array.from({ length: size }, () => f.element('div', article, {
        ...normal(), 'background-color': white
    }))
    return { ...f, first, second, ordinary }
}

function interaction(size, name, change) {
    const f = page(size)
    f.start()
    if (change) {
        f.first.source = normal()
        f.second.source = selected()
        f.first.setAttribute('aria-selected', 'false')
        f.second.setAttribute('aria-selected', 'true')
    }
    f.resetCounts()
    f.doc.emit(name, f.second)
    f.flush()
    const result = { counts: f.counts(), unrelatedReads: f.ordinary.reduce((sum, el) => sum + f.readsFor(el), 0),
        unrelatedPlanned: f.ordinary.reduce((sum, el) => sum + f.plannedFor(el), 0),
        unrelatedHookReads: f.ordinary.reduce((sum, el) => sum + f.hookReadsFor(el), 0),
        unrelatedPriorityReads: f.ordinary.reduce((sum, el) => sum + f.priorityReadsFor(el), 0),
        unrelatedRootReads: f.ordinary.reduce((sum, el) => sum + f.rootReadsFor(el), 0),
        unrelatedSamplingWrites: f.ordinary.reduce((sum, el) => sum + f.samplingWritesFor(el), 0) }
    if (change) {
        assert.equal(f.painted(f.second)['background-color'], '#000')
        assert.equal(f.painted(f.first)['background-color'], clear)
    }
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
    return result
}

test('already high contrast ordinary content needs no per-element output hooks', () => {
    const f = page()
    f.resetCounts()
    f.start()
    assert.equal(f.ordinary.filter(el => el.getAttribute('data-eink-contrast') !== null).length, 0)
    assert.deepEqual(parseColor(f.painted(f.second).color), parseColor('#000'))
    assert.equal(f.painted(f.first)['background-color'], '#000')
})

test('initial visible elements are sampled at most once after their transition preflight', () => {
    const f = page()
    f.resetCounts()
    f.start()
    const repeated = f.ordinary.filter(el => f.readsFor(el) > 6)
    assert.equal(repeated.length, 0, 'Urgent and background queues must not sample an element twice during the initial sweep')
})

for (const [name, change] of [['pointerover', false], ['click', true]]) {
    test(`local ${name} work does not grow with unrelated article content`, () => {
        const small = interaction(20, name, change)
        const large = interaction(1000, name, change)
        assert.equal(large.unrelatedReads, 0, 'A local control event must not resample an unrelated article')
        assert.equal(large.counts.sourceReads, small.counts.sourceReads)
        assert.equal(large.counts.outputRuleWrites, small.counts.outputRuleWrites)
        assertSampling(large.counts)
        assert.equal(large.unrelatedSamplingWrites, 0)
        assert.equal(large.counts.hookWrites, small.counts.hookWrites)
    })
}

test('periodic reconciliation is bounded and still detects unannounced CSSOM paint changes', () => {
    const f = page()
    f.start()
    const changed = f.ordinary[f.ordinary.length - 1]
    changed.source = { ...normal(), 'background-color': 'rgb(12, 20, 30)' }
    const ticks = Math.ceil(f.engine.stats().nodes / periodicBatch) + 2
    let converted = false
    for (let i = 0; i < ticks; i++) {
        f.resetCounts()
        f.tick()
        f.flush()
        assert.ok(f.counts().sourceReads <= periodicBatch * 6,
            `A periodic tick exceeded one ${periodicBatch}-element batch: ${f.counts().sourceReads} source reads`)
        assertSampling(f.counts())
        const background = parseColor(f.painted(changed)['background-color'])
        if (background && [0, 255].includes(background.r) && background.g === background.r && background.b === background.r) { converted = true; break }
    }
    assert.equal(converted, true, 'CSSOM changes without DOM mutations must eventually enter the sampled set')
    assert.equal(f.engine.stats().failures, 0)
})

test('unchanged periodic checks do not write attributes, inline paint or output rules', () => {
    const f = page()
    f.start()
    for (let i = 0; i < 3; i++) {
        f.resetCounts()
        f.tick()
        f.flush()
        const counts = f.counts()
        assert.equal(counts.attributeWrites, 0)
        assert.equal(counts.inlineWrites, 0)
        assert.equal(counts.outputRuleWrites, 0)
        assertSampling(counts)
    }
})

test('bounded reconciliation eventually finds native state changes without dispatched events', () => {
    const f = page()
    const input = f.element('input', f.doc.body)
    input.type = 'checkbox'
    input.checked = false
    const label = f.element('label', f.doc.body, normal())
    label.control = input
    f.start()
    input.checked = true
    label.source = selected()
    const ticks = Math.ceil(f.engine.stats().nodes / periodicBatch) + 2
    let converted = false
    for (let i = 0; i < ticks; i++) {
        f.resetCounts()
        f.tick()
        f.flush()
        assert.ok(f.counts().sourceReads <= periodicBatch * 6)
        assertSampling(f.counts())
        if (f.painted(label)['background-color'] === '#000') { converted = true; break }
    }
    assert.equal(converted, true)
    assert.equal(f.engine.stats().failures, 0)
})

test('local sampling leaves unrelated important author styles untouched until their periodic turn', () => {
    const f = page()
    const important = f.ordinary.slice(-4)
    for (const el of important) {
        el.style.setProperty('color', 'rgb(80, 80, 80)', 'important')
        el.style.setProperty('-webkit-text-fill-color', 'rgb(80, 80, 80)', 'important')
    }
    f.start()
    const converted = important.map(el => f.painted(el).color)
    assert.ok(converted.every(color => color !== 'rgb(80, 80, 80)'))
    for (const name of ['pointerover', 'click']) {
        if (name === 'click') {
            f.first.source = normal()
            f.second.source = selected()
            f.first.setAttribute('aria-selected', 'false')
            f.second.setAttribute('aria-selected', 'true')
        }
        f.resetCounts()
        f.doc.emit(name, f.second)
        f.flush()
        assert.ok(important.every(el => f.inlineWritesFor(el) === 0), name + ' rewrote unrelated inline important paint')
        assert.deepEqual(important.map(el => f.painted(el).color), converted)
    }
    f.resetCounts()
    f.tick()
    f.flush()
    assert.ok(important.every(el => f.inlineWritesFor(el) === 0), 'A bounded tick rewrote nodes outside its sampled slice')
    f.engine.stop()
    for (const el of important) for (const prop of ['color', '-webkit-text-fill-color']) {
        assert.equal(el.style.getPropertyValue(prop), 'rgb(80, 80, 80)')
        assert.equal(el.style.getPropertyPriority(prop), 'important')
    }
})

test('an unchanged local hover skips visual planning and unrelated output traversal', () => {
    const result = interaction(1000, 'pointerover', false)
    assert.equal(result.counts.planCalls, 0)
    assert.equal(result.counts.plannedRecords, 0)
    assert.equal(result.unrelatedHookReads, 0)
    assert.equal(result.unrelatedPriorityReads, 0)
    assert.equal(result.unrelatedRootReads, 0)
})

test('changed local controls plan and render only their dependency region', () => {
    const small = interaction(20, 'click', true)
    const large = interaction(1000, 'click', true)
    assert.ok(large.counts.planCalls > 0)
    assert.equal(large.unrelatedPlanned, 0)
    assert.equal(large.counts.plannedRecords, small.counts.plannedRecords)
    assert.equal(large.counts.maxPlanRecords, small.counts.maxPlanRecords)
    assert.equal(large.unrelatedHookReads, 0)
    assert.equal(large.unrelatedRootReads, 0)
    assert.ok(large.counts.hookReads <= small.counts.hookReads,
        'Hook reads grew from ' + small.counts.hookReads + ' to ' + large.counts.hookReads)
})

test('local work does not reread inline priorities across unrelated converted article nodes', () => {
    function run(size, name) {
        const f = page(size)
        for (const el of f.ordinary) {
            el.source.color = 'rgb(80, 80, 80)'
            el.source['-webkit-text-fill-color'] = 'rgb(80, 80, 80)'
        }
        f.start()
        if (name === 'click') {
            f.first.source = normal()
            f.second.source = selected()
            f.first.setAttribute('aria-selected', 'false')
            f.second.setAttribute('aria-selected', 'true')
        }
        f.resetCounts()
        f.doc.emit(name, f.second)
        f.flush()
        return { counts: f.counts(), unrelatedPriorityReads: f.ordinary.reduce((sum, el) => sum + f.priorityReadsFor(el), 0),
            unrelatedSamplingWrites: f.ordinary.reduce((sum, el) => sum + f.samplingWritesFor(el), 0) }
    }
    for (const name of ['pointerover', 'click']) {
        const small = run(20, name)
        const large = run(1000, name)
        assert.equal(large.unrelatedPriorityReads, 0, name + ' reread priorities for unrelated converted paint')
        assert.equal(large.counts.priorityReads, small.counts.priorityReads)
        assert.equal(large.unrelatedSamplingWrites, 0, name + ' temporarily changed unrelated output groups')
        assertSampling(large.counts)
    }
})

test('initial conversion spreads required output hooks across bounded scheduled callbacks', () => {
    const f = page()
    for (const el of f.ordinary) {
        el.source.color = 'rgb(80, 80, 80)'
        el.source['-webkit-text-fill-color'] = 'rgb(80, 80, 80)'
    }
    f.engine.start(f.doc)
    let callbacks = 0
    let totalHooks = 0
    while (f.frames.length) {
        assert.ok(++callbacks <= 400, 'Required initial conversion did not settle')
        f.resetCounts()
        f.frames.shift()()
        const writes = f.counts().hookWrites
        totalHooks += writes
        assert.ok(writes <= periodicBatch, 'One callback wrote ' + writes + ' output hooks')
    }
    assert.ok(totalHooks >= f.ordinary.length)
    assert.ok(f.ordinary.every(el => {
        const color = parseColor(f.painted(el).color)
        return color && color.r === 0 && color.g === 0 && color.b === 0
    }))
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})

test('bounded reconciliation samples new CSSOM paint on already converted article nodes', () => {
    const f = page()
    for (const el of f.ordinary) {
        el.source.color = 'rgb(80, 80, 80)'
        el.source['-webkit-text-fill-color'] = 'rgb(80, 80, 80)'
    }
    f.start()
    const last = f.ordinary[f.ordinary.length - 1]
    last.source = { ...last.source, 'background-color': 'rgb(12, 20, 30)', color: 'rgb(230, 240, 250)',
        '-webkit-text-fill-color': 'rgb(230, 240, 250)', 'outline-width': '3px', 'outline-style': 'solid', 'outline-color': 'rgb(12, 20, 30)' }
    assert.equal(f.painted(last)['outline-color'], 'rgb(12, 20, 30)')
    const ticks = Math.ceil(f.engine.stats().nodes / periodicBatch) + 2
    let converted = false
    for (let i = 0; i < ticks; i++) {
        f.resetCounts()
        f.tick()
        f.flush()
        assert.ok(f.counts().sourceReads <= periodicBatch * 6)
        assertSampling(f.counts())
        const style = f.painted(last)
        const outline = parseColor(style['outline-color'])
        if (outline && [0, 255].includes(outline.r) && outline.r === outline.g && outline.r === outline.b
            && style['outline-width'] === '3px' && style['outline-style'] === 'solid') { converted = true; break }
    }
    assert.equal(converted, true, 'A previously converted foreground cannot stand in for sampling newly authored paint')
    assert.equal(f.engine.stats().failures, 0)
})

test('shared paint groups bound the members invalidated by periodic source sampling', () => {
    const f = page()
    for (const el of f.ordinary) {
        el.source.color = 'rgb(80, 80, 80)'
        el.source['-webkit-text-fill-color'] = 'rgb(80, 80, 80)'
    }
    f.start()
    const ordinary = new Set(f.ordinary)
    assert.ok(f.paintGroupSizes().length > 0)
    assert.ok(f.paintGroupSizes().every(size => size <= periodicBatch), 'A shared output rule can invalidate more than one batch')
    for (let i = 0; i < 3; i++) {
        f.resetCounts()
        f.tick()
        f.flush()
        const counts = f.counts()
        assert.ok(counts.samplingRuleWrites > 0)
        assertSampling(counts)
        assert.ok(f.samplingMembers().filter(el => ordinary.has(el)).length <= periodicBatch * 2,
            'Sampling a slice temporarily invalidated unrelated output cohorts')
        assert.equal(counts.outputRuleWrites, 0)
        assert.equal(counts.hookWrites, 0)
        assert.equal(counts.inlineWrites, 0)
    }
})

test('startup performs no synchronous source reads, geometry reads or output hook writes', () => {
    const f = page()
    for (const el of f.ordinary) {
        el.source.color = 'rgb(80, 80, 80)'
        el.source['-webkit-text-fill-color'] = 'rgb(80, 80, 80)'
    }
    f.resetCounts()
    f.engine.start(f.doc)
    const startup = f.counts()
    assert.equal(startup.sourceReads, 0)
    assert.equal(startup.rectReads, 0)
    assert.equal(startup.hookWrites, 0)
    f.flush()
    assert.ok(f.ordinary.every(el => {
        const color = parseColor(f.painted(el).color)
        return color && color.r === 0 && color.g === 0 && color.b === 0
    }))
    assert.equal(f.painted(f.first)['background-color'], '#000')
    assert.equal(f.engine.stats().pending, 0)
    assert.equal(f.engine.stats().failures, 0)
})

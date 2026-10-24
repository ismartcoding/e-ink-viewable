const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const Policy = require('../src/high-contrast/contrast')
const Output = require('../src/high-contrast/contrast-output')

function tree(depth, flat = false) {
    let parentReads = 0
    const records = []
    for (let i = 0; i < depth; i++) {
        const parent = (flat ? records[0] : records.at(-1))?.node || null
        records.push({ node: {}, get parent() { parentReads++; return parent }, tag: i ? 'div' : 'html',
            hasText: true, hasChildren: true, shape: 'div:div', pseudos: {},
            rect: { width: 320, height: 32, left: 0, top: 0 }, style: {
                color: 'rgb(220, 220, 220)', '-webkit-text-fill-color': 'rgb(220, 220, 220)',
                'background-color': i ? 'rgba(0, 0, 0, 0)' : 'rgb(11, 16, 14)', 'background-image': 'none',
                display: 'block', visibility: 'visible', position: 'static', fill: 'none', stroke: 'none', 'text-shadow': 'none' } })
    }
    return { records, reads: () => parentReads }
}
function complete(steps, onYield = () => {}) {
    let next
    do { next = steps.next(); if (!next.done) onYield(next.value) } while (!next.done)
    return next.value
}

test('unprotected ancestor checks scale linearly through two thousand nested elements in either sampling order', () => {
    for (const reverse of [false, true]) {
        const counts = [500, 1000, 2000].map(depth => {
            const f = tree(depth), records = reverse ? [...f.records].reverse() : f.records
            const plans = Policy.createPlanner(C).plan(records)
            assert.equal(plans.size, depth)
            assert.equal(plans.get(f.records.at(-1).node).protected, false)
            assert.equal(plans.get(f.records.at(-1).node).rules[''].color, '#000')
            return f.reads()
        })
        assert.ok(counts[2] - counts[1] <= 2 * (counts[1] - counts[0]), `Ancestor reads grew faster than tree size: ${counts}`)
    }
})

test('deep-tree planning yields before exceeding the deterministic ancestor lookup budget', () => {
    const f = tree(2000), budget = 64
    const steps = Policy.createPlanner(C).planSteps([...f.records].reverse(), undefined, budget)
    let before = 0, processed = 0, next, yields = 0
    do {
        next = steps.next()
        assert.ok(f.reads() - before <= 3 * budget, 'One structural work item may read its parent at most three times')
        before = f.reads()
        if (!next.done) { assert.equal(next.value.processed - processed, budget); processed = next.value.processed; yields++ }
    } while (!next.done)
    assert.ok(yields > 1)
    assert.equal(next.value.size, f.records.length)
})

test('stepped and synchronous planning preserve the same visual classification', () => {
    const f = tree(512, true)
    for (let i = 1; i < f.records.length; i++) {
        f.records[i].tag = 'button'
        f.records[i].selected = i % 8 === 0
        if (f.records[i].selected) f.records[i].style['background-color'] = 'rgb(32, 40, 90)'
    }
    const expected = Policy.createPlanner(C).plan(f.records)
    const actual = complete(Policy.createPlanner(C).planSteps(f.records, undefined, 16))
    assert.deepEqual(actual, expected)
})

test('discarded planning steps do not publish partial palettes or resting state', () => {
    const f = tree(4, true)
    const colors = ['rgb(220, 0, 0)', 'rgb(0, 220, 0)', 'rgb(0, 0, 220)']
    for (let i = 1; i < 4; i++) {
        f.records[i].tag = 'button'
        f.records[i].style['background-color'] = colors[i - 1]
    }
    let yields = 0
    complete(Policy.createPlanner(C).planSteps(f.records, undefined, 1), () => { yields++ })
    const planner = Policy.createPlanner(C), abandoned = planner.planSteps(f.records, undefined, 1)
    for (let i = 0; i < yields; i++) assert.equal(abandoned.next().done, false)
    abandoned.return()
    const nextColors = ['rgb(220, 220, 0)', 'rgb(0, 220, 220)', 'rgb(220, 0, 220)']
    for (let i = 1; i < 4; i++) f.records[i].style['background-color'] = nextColors[i - 1]
    assert.deepEqual(planner.plan(f.records), Policy.createPlanner(C).plan(f.records))
})

test('repeated source colors are parsed once across all nodes and unchanged planning passes', () => {
    const f = tree(2000), calls = new Map()
    const color = { ...C, parseColor(value) { calls.set(value, (calls.get(value) || 0) + 1); return C.parseColor(value) } }
    const planner = Policy.createPlanner(color)
    planner.plan(f.records)
    planner.plan(f.records)
    assert.ok(calls.size > 0)
    for (const [value, count] of calls) assert.equal(count, 1, `Repeated parsing of ${value}`)
})

test('effective output steps inspect only requested targets while preserving their full parent dependencies', () => {
    const f = tree(1000, true), snapshots = new Map(f.records.map(r => [r.node, r]))
    const plans = Policy.createPlanner(C).plan(f.records), targets = f.records.slice(-3).map(r => r.node)
    let scans = 0, yields = 0
    plans[Symbol.iterator] = () => { scans++; return Map.prototype[Symbol.iterator].call(plans) }
    const result = complete(Output.effectivePlanSteps(C, plans, snapshots, 2, targets), value => { assert.equal(value.processed, 2); yields++ })
    assert.deepEqual([...result.keys()], targets)
    assert.equal(scans, 0)
    assert.equal(yields, 1)
    for (const node of targets) assert.equal(result.get(node).rules[''].color, '#000')
})

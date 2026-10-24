const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const Policy = require('../src/high-contrast/contrast')
const { effectivePlans } = require('../src/high-contrast/contrast-output')

const black = 'rgb(0, 0, 0)', white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
function record(parent = null, style = {}, extra = {}) {
    return { node: {}, parent: parent?.node || null, tag: 'div', hasText: true, hasChildren: false,
        rect: { width: 160, height: 32, left: 0, top: 0 }, pseudos: {}, style: {
            color: black, '-webkit-text-fill-color': black, 'background-color': clear, 'background-image': 'none',
            display: 'block', visibility: 'visible', fill: 'none', stroke: 'none', 'text-shadow': 'none', ...style }, ...extra }
}
const snapshots = records => new Map(records.map(r => [r.node, r]))
const rules = (plans, r, pseudo = '') => plans.get(r.node).rules[pseudo] || {}

test('a thousand ordinary white surfaces and black text need no per-element paint output', () => {
    const root = record(null, { 'background-color': white }, { tag: 'html' })
    const records = [root, ...Array.from({ length: 1000 }, () => record(root, { 'background-color': white }))]
    const original = Policy.createPlanner(C).plan(records)
    const effective = effectivePlans(C, original, snapshots(records))
    assert.equal(records.slice(1).filter(r => Object.keys(effective.get(r.node).rules).length).length, 0)
    assert.equal(rules(effective, root)['color-scheme'], 'light')
    assert.equal(rules(original, records[1]).color, '#000')
})

test('white badge glyphs retain their own black paint when the selected parent becomes white text', () => {
    const root = record(null, { 'background-color': white }, { tag: 'html' })
    const selected = record(root, { color: white, '-webkit-text-fill-color': white, 'background-color': 'rgb(32, 40, 90)' },
        { tag: 'button', selected: true, focusable: true })
    const badge = record(selected, { 'background-color': white })
    const glyph = record(badge)
    const records = [root, selected, badge, glyph]
    const effective = effectivePlans(C, Policy.createPlanner(C).plan(records), snapshots(records))
    assert.equal(rules(effective, selected)['background-color'], '#000')
    assert.equal(rules(effective, selected).color, '#fff')
    assert.equal(rules(effective, badge).color, '#000')
    assert.equal(rules(effective, badge)['-webkit-text-fill-color'], '#000')
    assert.equal(rules(effective, badge)['background-color'], undefined)
    assert.deepEqual(effective.get(glyph.node).rules, {})
})

test('source-equal child foreground stays explicit when its parent has a different converted foreground', () => {
    const parent = record(), child = record(parent)
    const plans = new Map([[parent.node, { rules: { '': { color: '#fff', '-webkit-text-fill-color': '#fff' } } }],
        [child.node, { rules: { '': { color: '#000', '-webkit-text-fill-color': '#000' } } }]])
    const result = effectivePlans(C, plans, snapshots([parent, child]))
    assert.equal(rules(result, child).color, '#000')
    assert.equal(rules(result, child)['-webkit-text-fill-color'], '#000')
})

test('currentColor-dependent source-equal borders backgrounds and SVG paint remain explicit across foreground changes', () => {
    const r = record(null, { 'background-color': black, 'border-top-color': black, fill: black, stroke: black,
        'outline-color': black, 'text-decoration-color': black, 'box-shadow': 'rgb(0, 0, 0) 0px 0px 4px' })
    const props = { color: '#fff', 'background-color': '#000', 'border-top-color': '#000', fill: '#000', stroke: '#000',
        'outline-color': '#000', 'text-decoration-color': '#000', 'box-shadow': r.style['box-shadow'] }
    const plans = new Map([[r.node, { rules: { '': props } }]])
    const result = effectivePlans(C, plans, snapshots([r]))
    assert.deepEqual(rules(result, r), props)
})

test('pseudo glyph paint does not inherit a differently converted host foreground', () => {
    const host = record()
    host.pseudos['::before'] = { color: black, '-webkit-text-fill-color': black, 'background-color': white, 'text-shadow': 'none' }
    const plans = new Map([[host.node, { rules: { '': { color: '#fff', '-webkit-text-fill-color': '#fff' },
        '::before': { color: '#000', '-webkit-text-fill-color': '#000', 'background-color': '#fff', 'text-shadow': 'none' } } }]])
    const result = effectivePlans(C, plans, snapshots([host]))
    assert.equal(rules(result, host, '::before').color, '#000')
    assert.equal(rules(result, host, '::before')['-webkit-text-fill-color'], '#000')
    assert.equal(rules(result, host, '::before')['background-color'], undefined)
    assert.equal(rules(result, host, '::before')['text-shadow'], undefined)
})

test('unknown source paint and unresolved cascade values are retained without changing input plans or snapshots', () => {
    const parent = record(), child = record(parent), unknown = {}
    const plans = new Map([[parent.node, { protected: false, rules: {} }],
        [child.node, { protected: false, rules: { '': { color: 'var(--ink)', 'background-color': 'currentColor' },
            '::after': { color: '#000' } } }], [unknown, { rules: { '': { color: '#000' } } }]])
    child.style.color = 'var(--ink)'; child.style['background-color'] = 'currentColor'
    const source = snapshots([parent, child]), before = structuredClone([...plans.values()]), beforeSource = structuredClone(child.style)
    const result = effectivePlans(C, plans, source)
    assert.deepEqual(result.get(child.node), plans.get(child.node))
    assert.deepEqual(result.get(unknown), plans.get(unknown))
    assert.deepEqual([...plans.values()], before)
    assert.deepEqual(child.style, beforeSource)
})

test('a missing parent snapshot does not justify removing inherited paint', () => {
    const r = record({ node: {} })
    const plans = new Map([[r.node, { rules: { '': { color: '#000' } } }]])
    assert.equal(rules(effectivePlans(C, plans, snapshots([r])), r).color, '#000')
})

test('an unknown source shadow is retained rather than assuming the browser default', () => {
    const r = record()
    delete r.style['text-shadow']
    const plans = new Map([[r.node, { rules: { '': { 'text-shadow': 'none' } } }]])
    assert.equal(rules(effectivePlans(C, plans, snapshots([r])), r)['text-shadow'], 'none')
})

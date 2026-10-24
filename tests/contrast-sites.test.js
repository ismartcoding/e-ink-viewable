const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const Policy = require('../src/high-contrast/contrast')
const { loadSites, measure, directTextRecords } = require('./helpers/site-replay')
const sites = loadSites()
const immutable = records => JSON.stringify(records.map(({ node, parent, svgRoot, ...source }) => source))
const paints = (plans, records) => records.map(r => plans.get(r.node))

test('website corpus contains 20 independent origins and genuine source colors and geometry', () => {
    assert.equal(new Set(sites.map(site => new URL(site.url).origin)).size, 20)
    for (const site of sites) {
        assert.ok(site.records.length >= 100, site.name)
        assert.ok(site.records.some(r => r.style.color.startsWith('rgb') || r.style.color.startsWith('oklch')), site.name)
        assert.ok(site.records.some(r => r.rect.width > 96), site.name)
    }
})

test('readability rejects converted root containers when every direct text node is protected', () => {
    const node = {}, body = {}, main = {}, text = {}
    const style = { color: 'rgb(220, 220, 220)', '-webkit-text-fill-color': 'rgb(220, 220, 220)',
        'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', display: 'block', visibility: 'visible' }
    const record = (id, current, parent, tag, shape) => ({ id, node: current, parent, tag, shape, hasText: true,
        style: { ...style }, rect: { width: 320, height: 32 } })
    const site = { records: [record(0, node, null, 'html', 'html:body'), record(1, body, node, 'body', 'body:main'),
        record(2, main, body, 'main', 'main:p'), record(3, text, main, 'p', 'p:')] }
    const plans = new Map(site.records.map(r => [r.node, r.node === node
        ? { protected: false, rules: { '': { color: '#000', 'background-color': '#fff' } } }
        : { protected: true, rules: {} }]))
    const result = measure(site, plans)
    assert.deepEqual(result.converted, [0])
    assert.deepEqual(result.eligibleText, [3])
    assert.deepEqual(result.protectedText, [3])
    assert.deepEqual(result.text, [])
    assert.deepEqual(result.issues, ['Ordinary node 1 was protected', 'Ordinary node 2 was protected', 'Ordinary node 3 was protected',
        'No converted visible direct text checked'])
})

test('direct text candidates require leaf structure captured in both shape and parent relationships', () => {
    const root = {}, ancestor = {}, omittedChild = {}, leaf = {}, contradictory = {}, child = {}
    const record = (node, parent, tag, shape) => ({ node, parent, tag, shape, hasText: true, hasChildren: false })
    const records = [record(root, null, 'html', 'html:'), record(ancestor, root, 'div', 'div:span'),
        record(omittedChild, ancestor, 'p', 'p:strong'), record(leaf, ancestor, 'span', 'span:'),
        record(contradictory, ancestor, 'div', 'div:'), record(child, contradictory, 'span', 'span:')]
    assert.deepEqual(directTextRecords(records).map(r => r.node), [leaf, child])
})

for (const site of sites) {
    test(`${site.name}: source replay keeps readable text, bounded protection and stable state without layout edits`, () => {
        const planner = Policy.createPlanner(C)
        const before = immutable(site.records)
        const plans = planner.plan(site.records, site.viewport)
        const result = measure(site, plans)
        assert.equal(immutable(site.records), before, 'Source snapshots must remain unchanged')
        assert.ok(result.converted.length > 0, 'Conversion must not silently protect the whole page')
        assert.ok(result.eligibleText.length > 0, 'The capture must contain visible direct text')
        assert.deepEqual(result.issues, [], 'Readability must exercise converted direct text rather than root or ancestor containers')
        for (const plan of plans.values()) for (const props of Object.values(plan.rules)) {
            for (const key of Object.keys(props)) {
                assert.ok(!['display', 'visibility', 'opacity', 'transform', 'position', 'width', 'height', 'padding', 'margin', 'gap', 'pointer-events'].includes(key), `Layout or usability changed: ${key}`)
            }
        }
        const first = paints(plans, site.records)
        assert.deepEqual(paints(planner.plan(site.records, site.viewport), site.records), first)
        assert.deepEqual(paints(planner.plan([...site.records].reverse(), site.viewport), site.records), first)
        planner.reset()
        assert.deepEqual(paints(planner.plan(site.records, site.viewport), site.records), first)
    })
}

for (const [initialName, nextName] of [['mui', 'mui-second'], ['radix', 'radix-password'], ['antdesign', 'antdesign-second']]) {
    test(`${initialName}: captured tab switch removes the old cue and transfers it to the new tab`, () => {
        const initial = loadSites().find(s => s.name === initialName)
        const next = loadSites().find(s => s.name === nextName)
        const oldTabs = initial.records.filter(r => r.role === 'tab').slice(0, 3)
        const nextTabs = next.records.filter(r => r.role === 'tab').slice(0, oldTabs.length)
        const oldSelected = oldTabs.findIndex(r => r.selected)
        const newSelected = nextTabs.findIndex(r => r.selected)
        assert.notEqual(oldSelected, newSelected, 'The corpus must contain an actual tab switch')
        const planner = Policy.createPlanner(C)
        for (const r of initial.records) r.focus = false
        const before = planner.plan(initial.records, initial.viewport)
        for (let i = 0; i < oldTabs.length; i++) {
            Object.assign(oldTabs[i], { style: { ...nextTabs[i].style }, pseudos: nextTabs[i].pseudos, selected: nextTabs[i].selected })
        }
        const after = planner.plan(initial.records, initial.viewport)
        assert.notDeepEqual(after.get(oldTabs[oldSelected].node).rules, before.get(oldTabs[oldSelected].node).rules)
        assert.notDeepEqual(after.get(oldTabs[newSelected].node).rules, before.get(oldTabs[newSelected].node).rules)
        assert.deepEqual(after.get(oldTabs[oldSelected].node).rules, before.get(oldTabs[newSelected].node).rules)
    })
}

function acceptanceFixture() {
    const root = {}, first = {}, second = {}
    const style = { color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 255, 255)',
        'background-image': 'none', display: 'block', visibility: 'visible', opacity: '1' }
    const record = (id, node, parent, tag, shape) => ({ id, node, parent, tag, shape, hasText: true,
        rect: { left: 0, top: id * 40, width: 320, height: 32 }, style: { ...style }, pseudos: {} })
    const site = { records: [record(0, root, null, 'html', 'html:p,p'), record(1, first, root, 'p', 'p:'), record(2, second, root, 'p', 'p:')] }
    const plans = new Map(site.records.map(r => [r.node, { protected: false,
        rules: { '': { color: '#000', '-webkit-text-fill-color': '#000', 'background-color': '#fff' } } }]))
    return { site, plans, root: site.records[0], first: site.records[1], second: site.records[2] }
}

test('source replay rejects an ordinary protected paragraph even when another paragraph converts', () => {
    const f = acceptanceFixture()
    f.plans.set(f.second.node, { protected: true, rules: {} })
    assert.ok(measure(f.site, f.plans).issues.some(issue => issue.includes('Ordinary node 2 was protected')))
})

test('source replay rejects black ordinary text surfaces despite their maximum contrast ratio', () => {
    const f = acceptanceFixture()
    f.plans.set(f.second.node, { protected: false, rules: { '': { color: '#fff', '-webkit-text-fill-color': '#fff', 'background-color': '#000' } } })
    assert.ok(measure(f.site, f.plans).issues.some(issue => issue.includes('Ordinary text 2 must have a white surface and black glyphs')))
})

test('source replay rejects selected and unselected peers with identical white paint', () => {
    const f = acceptanceFixture()
    f.first.role = f.second.role = 'tab'
    f.first.selected = true
    assert.ok(measure(f.site, f.plans).issues.some(issue => issue.includes('Selected node 1 has no distinct cue')))
})

test('source replay allows actual image protection without exempting ordinary siblings', () => {
    const f = acceptanceFixture()
    f.first.style['background-image'] = 'url("photo.png")'
    f.plans.set(f.first.node, { protected: true, rules: {} })
    assert.deepEqual(measure(f.site, f.plans).issues, [])
    f.plans.set(f.second.node, { protected: true, rules: {} })
    assert.ok(measure(f.site, f.plans).issues.some(issue => issue.includes('Ordinary node 2 was protected')))
})

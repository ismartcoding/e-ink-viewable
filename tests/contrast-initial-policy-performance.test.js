const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const C = require('../src/color')

function policy() {
    const math = Object.create(Math), work = { cbrt: 0, hypot: 0 }
    for (const name of Object.keys(work)) math[name] = (...args) => { work[name]++; return Math[name](...args) }
    const context = { module: { exports: {} }, Math: math }
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/high-contrast/contrast'), 'utf8'), context)
    return { ...context.module.exports, work }
}
function content(count, background) {
    const record = (tag, parent, bg, top = 0) => ({ node: {}, parent: parent?.node || null, tag,
        hasText: true, hasChildren: false, shape: tag + ':', rect: { width: 320, height: 32, left: 0, top }, pseudos: {},
        style: { color: 'rgb(80,80,80)', '-webkit-text-fill-color': 'rgb(80,80,80)', 'background-color': bg,
            'background-image': 'none', display: 'block', visibility: 'visible', position: 'static', fill: 'none', stroke: 'none',
            'box-shadow': 'none', 'outline-style': 'none' } })
    const root = record('html', null, 'rgb(255,255,255)'), article = record('article', root, 'rgb(255,255,255)')
    const rows = Array.from({ length: count }, (_, i) => record('div', article, background, i * 32))
    return { rows, records: [root, article, ...rows] }
}

for (const background of ['rgb(255,255,255)', 'rgb(20,20,20)']) {
    test(`ordinary repeated content with ${background} paint avoids perceptual color work unrelated to interaction`, () => {
        for (const count of [20, 1000, 10000]) {
            const p = policy(), f = content(count, background), plans = p.createPlanner(C).plan(f.records)
            for (const r of f.rows) {
                assert.equal(plans.get(r.node).protected, false)
                assert.equal(plans.get(r.node).rules['']['background-color'], '#fff')
                assert.equal(plans.get(r.node).rules[''].color, '#000')
            }
            assert.equal(p.work.cbrt, 0)
            assert.equal(p.work.hypot, 0)
        }
    })
}

test('equal RGB values need no perceptual conversion even when alpha differs', () => {
    const p = policy()
    assert.equal(p.distance({ r: 120, g: 40, b: 80, a: 0.1 }, { r: 120, g: 40, b: 80, a: 1 }), 0)
    assert.equal(p.work.cbrt, 0)
    assert.equal(p.work.hypot, 0)
})

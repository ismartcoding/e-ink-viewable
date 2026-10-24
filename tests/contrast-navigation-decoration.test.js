const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const Policy = require('../src/high-contrast/contrast')

const dim = 'rgb(148, 163, 156)'
function navigation(kind = 'mask') {
    const make = (tag, parent, style = {}) => ({ node: {}, parent: parent?.node || null, tag, selected: false,
        hasText: true, hasChildren: false, shape: tag, pseudos: {},
        rect: { width: 96, height: 24, left: 0, top: 0 },
        style: { color: dim, '-webkit-text-fill-color': dim, 'background-color': 'rgba(0,0,0,0)',
            'background-image': 'none', display: 'inline-flex', visibility: 'visible', position: 'static',
            fill: 'none', stroke: 'none', 'box-shadow': 'none', 'outline-style': 'none', ...style } })
    const root = make('html', null, { 'background-color': 'rgb(11,16,14)' })
    const nav = make('nav', root)
    const links = Array.from({ length: 4 }, () => make('a', nav))
    const posts = links[3]
    posts.pseudos['::before'] = { content: '""', display: 'block', position: 'static', width: '16px', height: '16px',
        color: dim, 'background-color': dim, 'background-image': 'none', 'mask-image': 'url("icon.svg")' }
    if (kind === 'image') Object.assign(posts.pseudos['::before'], {
        'background-color': 'rgb(0,0,0)', 'background-image': 'url("icon.svg")', 'mask-image': 'none'
    })
    return { links, posts, records: [root, nav, ...links] }
}

for (const kind of ['mask', 'image']) test(`a decorative ${kind} icon does not invent a selected border on an ordinary navigation link`, () => {
    const f = navigation(kind), plans = Policy.createPlanner(C).plan(f.records)
    for (const link of f.links) {
        const paint = plans.get(link.node).rules[''] || {}
        assert.equal(paint['box-shadow'], undefined)
        assert.equal(paint['outline-style'], undefined)
    }
    const icon = plans.get(f.posts.node).rules['::before'] || {}
    if (kind === 'mask') assert.equal(icon['background-color'], '#000')
    else assert.equal(icon['background-image'], undefined)
})

test('a navigation link with a decorative icon still retains an explicit selected cue', () => {
    const f = navigation(), planner = Policy.createPlanner(C)
    f.posts.selected = true
    const paint = planner.plan(f.records).get(f.posts.node).rules['']
    assert.match(paint['box-shadow'], /inset/)
    f.posts.selected = false
    const cleared = planner.plan(f.records).get(f.posts.node).rules[''] || {}
    assert.equal(cleared['box-shadow'], undefined)
    assert.equal(cleared['outline-style'], undefined)
})

test('a full surface pseudo background still preserves visual selection without ARIA', () => {
    const f = navigation()
    Object.assign(f.posts.pseudos['::before'], { width: '96px', height: '24px', 'mask-image': 'none', 'background-color': 'rgb(0,0,0)' })
    const plans = Policy.createPlanner(C).plan(f.records)
    assert.equal(plans.get(f.posts.node).rules[''].color, '#fff')
    assert.equal(plans.get(f.posts.node).rules['::before']['background-color'], '#000')
})

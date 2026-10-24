const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color.js')
const Policy = require('../src/high-contrast/contrast.js')
const Dom = require('../src/high-contrast/contrast-dom.js')

const white = 'rgb(255, 255, 255)'
const black = 'rgb(0, 0, 0)'
const clear = 'rgba(0, 0, 0, 0)'

function record(tag = 'div', overrides = {}) {
    return {
        node: {}, tag, role: '', parent: null, hasText: true, hasChildren: false,
        rect: { width: 120, height: 32, left: 0, top: 0 }, shape: tag, selected: false,
        style: { color: black, '-webkit-text-fill-color': black, 'background-color': clear,
            'background-image': 'none', display: 'block', visibility: 'visible', position: 'static',
            fill: 'none', stroke: 'none', 'outline-style': 'none', 'box-shadow': 'none' },
        pseudos: {}, ...overrides
    }
}

function styled(r, props) {
    Object.assign(r.style, props)
    return r
}

function fixture() {
    const root = styled(record('html'), { 'background-color': white })
    const nav = record('nav', { parent: root.node, hasChildren: true })
    const a = record('button', { parent: nav.node })
    const b = record('button', { parent: nav.node })
    return { root, nav, a, b, records: [root, nav, a, b], planner: Policy.createPlanner(C) }
}

function props(plans, r, pseudo = '') { return plans.get(r.node).rules[pseudo] || {} }

test('selected control keeps black fill and coordinated white foreground', () => {
    const f = fixture()
    f.a.selected = true
    styled(f.a, { 'background-color': black, color: white, '-webkit-text-fill-color': white })
    const plans = f.planner.plan(f.records)
    assert.equal(props(plans, f.a)['background-color'], '#000')
    assert.equal(props(plans, f.a).color, '#fff')
    assert.equal(props(plans, f.b).color, '#000')
    assert.equal(props(plans, f.b)['background-color'], undefined)
})

test('visual selection works without ARIA, class names or native state', () => {
    const f = fixture()
    styled(f.a, { 'background-color': 'rgb(32, 40, 90)', color: white })
    let plans = f.planner.plan(f.records)
    assert.equal(props(plans, f.a)['background-color'], '#000')
    styled(f.a, { 'background-color': clear, color: black })
    styled(f.b, { 'background-color': 'rgb(32, 40, 90)', color: white })
    plans = f.planner.plan(f.records)
    assert.equal(props(plans, f.b)['background-color'], '#000')
    assert.equal(props(plans, f.a)['background-color'], undefined)
})

test('empty plan removes prior selected fill when selection is cleared', () => {
    const f = fixture()
    f.a.selected = true
    styled(f.a, { 'background-color': black })
    f.planner.plan(f.records)
    f.a.selected = false
    styled(f.a, { 'background-color': clear })
    const plans = f.planner.plan(f.records)
    assert.equal(props(plans, f.a)['background-color'], undefined)
    assert.equal(props(plans, f.a)['box-shadow'], undefined)
})

test('nested white badge uses black glyphs inside black selected control', () => {
    const f = fixture()
    f.a.selected = true
    styled(f.a, { 'background-color': black, color: white })
    const text = styled(record('span', { parent: f.a.node }), { color: white })
    const badge = styled(record('span', { parent: f.a.node }), { 'background-color': white, color: black })
    const svg = styled(record('path', { parent: f.a.node, svg: true }), { fill: white, stroke: 'none' })
    const plans = f.planner.plan([...f.records, text, badge, svg])
    assert.equal(props(plans, text).color, '#fff')
    assert.equal(props(plans, badge)['background-color'], '#fff')
    assert.equal(props(plans, badge).color, '#000')
    assert.equal(props(plans, svg).fill, '#fff')
    assert.equal(props(plans, svg).stroke, undefined)
})

test('large selected row keeps white surface and a non-layout boundary', () => {
    const f = fixture()
    f.a.selected = true
    f.a.rect = { width: 960, height: 160, top: 0, left: 0 }
    styled(f.a, { 'background-color': black })
    const p = props(f.planner.plan(f.records), f.a)
    assert.equal(p['background-color'], '#fff')
    assert.match(p['box-shadow'], /inset/)
    assert.equal(p['border-width'], undefined)
    assert.equal(p.padding, undefined)
})

test('same-luminance different hues remain distinct and mapping is stable', () => {
    const f = fixture()
    styled(f.a, { 'background-color': 'rgb(255, 0, 0)' })
    styled(f.b, { 'background-color': 'rgb(0, 130, 0)' })
    const first = f.planner.plan(f.records)
    assert.notDeepEqual(props(first, f.a), props(first, f.b))
    const second = f.planner.plan([f.root, f.nav, f.b, f.a])
    assert.deepEqual(props(first, f.a), props(second, f.a))
    assert.deepEqual(props(first, f.b), props(second, f.b))
})

test('text-only accent difference survives as text decoration without a container frame', () => {
    const f = fixture()
    styled(f.a, { color: 'rgb(0, 0, 255)' })
    const plans = f.planner.plan(f.records)
    assert.notDeepEqual(props(plans, f.a), props(plans, f.b))
    assert.equal(props(plans, f.a).color, '#000')
    assert.equal(props(plans, f.b).color, '#000')
    assert.equal(props(plans, f.a)['box-shadow'], undefined)
    assert.equal(props(plans, f.a)['outline-style'], undefined)
    assert.equal(props(plans, f.a)['text-decoration-style'], 'double')
})

test('hover feedback does not become persistent selected fill', () => {
    const f = fixture()
    f.planner.plan(f.records)
    f.a.transient = true
    styled(f.a, { 'background-color': 'rgb(32, 32, 32)', color: white })
    const p = props(f.planner.plan(f.records), f.a)
    assert.notEqual(p['background-color'], '#000')
    assert.match(p['box-shadow'], /inset/)
})

test('focus remains distinct from selected state', () => {
    const f = fixture()
    f.a.selected = true
    f.a.focus = true
    styled(f.a, { 'background-color': black })
    const p = props(f.planner.plan(f.records), f.a)
    assert.equal(p['background-color'], '#000')
    assert.equal(p['outline-style'], 'solid')
    assert.equal(p['outline-color'], '#000')
    assert.match(p['box-shadow'], /4px #fff/)
})

test('multiple selected items get boundaries when fill budget is exceeded', () => {
    const f = fixture()
    f.a.selected = f.b.selected = true
    const plans = f.planner.plan(f.records)
    for (const r of [f.a, f.b]) assert.match(props(plans, r)['box-shadow'], /inset/)
})

test('disabled and hidden controls retain their actual usability and visibility', () => {
    const f = fixture()
    f.a.selected = true
    f.a.disabled = true
    styled(f.b, { display: 'none' })
    const plans = f.planner.plan(f.records)
    assert.equal(props(plans, f.a)['box-shadow'], undefined)
    assert.deepEqual(props(plans, f.b), {})
    assert.equal(props(plans, f.a).opacity, undefined)
})

test('photos and overlay foregrounds retain their source colors', () => {
    const f = fixture()
    const hero = styled(record('section', { parent: f.root.node }), { 'background-image': 'url("hero.png")', color: white })
    const title = styled(record('h1', { parent: hero.node }), { color: white })
    const plans = f.planner.plan([...f.records, hero, title])
    assert.equal(plans.get(hero.node).protected, true)
    assert.equal(props(plans, hero).color, white)
    assert.deepEqual(props(plans, title), {})
    assert.equal(props(plans, f.a).color, '#000')
})

test('positioned foreground sibling of media is part of protection scope', () => {
    const f = fixture()
    const panel = styled(record('section', { parent: f.root.node }), { 'background-color': black, position: 'relative' })
    const photo = record('img', { parent: panel.node })
    const title = styled(record('h2', { parent: panel.node }), { position: 'absolute', color: white })
    const plans = f.planner.plan([...f.records, panel, photo, title])
    assert.equal(plans.get(panel.node).protected, true)
    assert.deepEqual(props(plans, title), {})
})

test('a normal image inside a positioned link does not protect the entire page', () => {
    const f = fixture()
    styled(f.a, { position: 'relative' })
    const img = record('img', { parent: f.a.node })
    const plans = f.planner.plan([...f.records, img])
    assert.equal(plans.get(f.root.node).protected, false)
})

test('multicolor SVG charts retain their source paints', () => {
    const f = fixture()
    const panel = styled(record('section', { parent: f.root.node }), { 'background-color': white })
    const svg = record('svg', { parent: panel.node, svg: true })
    svg.svgRoot = svg.node
    const paths = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)'].map(fill => styled(record('path', { parent: svg.node, svg: true, svgRoot: svg.node }), { fill }))
    const plans = f.planner.plan([...f.records, panel, svg, ...paths])
    assert.equal(plans.get(svg.node).protected, true)
    for (const path of paths) assert.deepEqual(props(plans, path), {})
})

test('pseudo underline contrasts with its own surface', () => {
    const f = fixture()
    f.a.pseudos['::after'] = { content: '""', width: '120px', height: '4px', 'background-color': 'rgb(255,0,0)' }
    const p = props(f.planner.plan(f.records), f.a, '::after')
    assert.equal(p['background-color'], '#000')
})

test('pseudo tooltip is a surface rather than a black rectangle over black text', () => {
    const f = fixture()
    f.a.pseudos['::after'] = { content: '"Tip"', width: '160px', height: '48px', 'background-color': black, color: white }
    const p = props(f.planner.plan(f.records), f.a, '::after')
    assert.equal(p['background-color'], '#fff')
    assert.equal(p.color, '#000')
})

test('full-sized pseudo background coordinates with selected host foreground', () => {
    const f = fixture()
    f.a.selected = true
    f.a.pseudos['::before'] = { content: '""', width: '120px', height: '32px', 'background-color': black }
    const plans = f.planner.plan(f.records)
    assert.equal(props(plans, f.a).color, '#fff')
    assert.equal(props(plans, f.a, '::before')['background-color'], '#000')
})

test('small pseudo image icon is kept without protecting host or clearing image', () => {
    const f = fixture()
    f.a.pseudos['::before'] = { content: '""', width: '24px', height: '24px', 'background-image': 'url("icon.png")' }
    const plans = f.planner.plan(f.records)
    assert.equal(plans.get(f.a.node).protected, false)
    assert.deepEqual(props(plans, f.a, '::before'), {})
})

test('transparent and none paints are not turned into solid marks', () => {
    const f = fixture()
    styled(f.a, { color: clear, fill: 'none', stroke: clear, 'border-top-width': '1px', 'border-top-color': clear })
    const p = props(f.planner.plan(f.records), f.a)
    for (const name of ['color', 'fill', 'stroke', 'border-top-color', 'background-color']) assert.equal(p[name], undefined)
})

test('painted borders and shadows are preserved without adding layout widths', () => {
    const f = fixture()
    styled(f.nav, { 'border-top-width': '1px', 'border-top-color': white,
        'box-shadow': 'rgb(59, 130, 246) 0px 4px 8px 0px' })
    const p = props(f.planner.plan(f.records), f.nav)
    assert.equal(p['border-top-color'], '#000')
    assert.match(p['box-shadow'], /#000/)
    assert.equal(p['border-top-width'], undefined)
})

test('palette exhaustion converts ordinary controls instead of exempting the whole group', () => {
    const f = fixture()
    const extras = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)', 'rgb(255,255,0)', 'rgb(0,255,255)'].map(color => styled(record('button', { parent: f.nav.node }), { color }))
    const plans = f.planner.plan([...f.records, ...extras])
    for (const r of extras) {
        assert.equal(plans.get(r.node).protected, false)
        assert.equal(props(plans, r).color, '#000')
        assert.equal(props(plans, r)['background-color'], undefined)
    }
})

test('reset starts a fresh palette after an overall theme change', () => {
    const f = fixture()
    styled(f.a, { color: 'rgb(255,0,0)' })
    f.planner.plan(f.records)
    f.planner.reset()
    const a = f.planner.plan(f.records)
    const b = Policy.createPlanner(C).plan(f.records)
    assert.deepEqual(props(a, f.a), props(b, f.a))
})

test('legacy sRGB alpha compositing does not incorrectly use linear light', () => {
    const result = Policy.over({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })
    assert.equal(result.r, 127.5)
    assert.ok(Policy.distance({ r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 130, b: 0, a: 1 }) > 0.1)
})

test('color transitions are removed while transform timing and delay keep their positions', () => {
    const result = Policy.transitionPlan({ property: 'color, transform', duration: '0.2s, 2s', delay: '0s, 0.5s', timing: 'linear, ease-in' }, [])
    assert.equal(result['transition-property'], 'transform')
    assert.equal(result['transition-duration'], '2s')
    assert.equal(result['transition-delay'], '0.5s')
    assert.equal(result['transition-timing-function'], 'ease-in')
})

test('all expansion preserves non-paint transitions and explicit later overrides', () => {
    const result = Policy.transitionPlan({ property: 'all, transform', duration: '1s, 3s' }, ['color', 'background-color', 'opacity', 'width', 'transform'])
    assert.equal(result['transition-property'], 'opacity,width,transform')
    assert.equal(result['transition-duration'], '1s,1s,3s')
})

test('default and non-paint transitions need no suppression rule', () => {
    assert.equal(Policy.transitionPlan({ property: 'all', duration: '0s' }, ['color']), null)
    assert.equal(Policy.transitionPlan({ property: 'transform', duration: '1s' }, []), null)
    assert.deepEqual(Policy.transitionPlan({ property: 'color', duration: '1s' }, []), { 'transition-property': 'none' })
})

function layerFixture() {
    const rules = []
    const sheet = { cssRules: rules, disabled: false,
        insertRule(text, index) { rules.splice(index, 0, { selectorText: text.slice(0, text.indexOf('{')), style: { cssText: text.slice(text.indexOf('{') + 1, -1) } }); return index },
        deleteRule(index) { rules.splice(index, 1) } }
    const style = { isConnected: true, sheet, remove() { this.isConnected = false } }
    const root = { nodeType: 9, createElement: () => style, documentElement: { appendChild() { style.isConnected = true } } }
    return { root, style, layer: Dom.createRuleLayer(root, new WeakSet()) }
}

test('identical plans cause no new CSS rule writes', () => {
    const { layer } = layerFixture()
    layer.set('1', '[data-id="1"]', { color: '#000' })
    const before = layer.stats()
    for (let i = 0; i < 1000; i++) layer.set('1', '[data-id="1"]', { color: '#000' })
    assert.deepEqual(layer.stats(), before)
})

test('a thousand state changes replace rules instead of accumulating reset CSS', () => {
    const { layer, style } = layerFixture()
    for (let i = 0; i < 1000; i++) layer.set('1', '[data-id="1"]', { color: i % 2 ? '#000' : '#fff' })
    assert.equal(style.sheet.cssRules.length, 1)
    layer.set('1', '', {})
    assert.equal(style.sheet.cssRules.length, 0)
})

test('removed plans, pseudo rules and style layers can be completely released', () => {
    const { layer, style } = layerFixture()
    layer.set('1', '[data-id="1"]', { color: '#000' })
    layer.set('1::after', '[data-id="1"]::after', { 'background-color': '#000' })
    layer.retain(new Set(['1']))
    assert.equal(style.sheet.cssRules.length, 1)
    layer.disable(true)
    assert.equal(style.sheet.disabled, true)
    layer.disable(false)
    layer.remove()
    assert.equal(layer.stats().rules, 0)
    assert.equal(style.isConnected, false)
})

test('an unpainted selected control remains readable on a white page', () => {
    const f = fixture()
    f.a.selected = true
    const p = props(f.planner.plan(f.records), f.a)
    assert.equal(p.color, '#000')
    assert.match(p['box-shadow'], /inset/)
})

test('large empty backgrounds do not turn into black graphic blocks', () => {
    const f = fixture()
    const panel = styled(record('div', { parent: f.root.node, hasText: false, rect: { width: 800, height: 600 } }), { 'background-color': black })
    assert.equal(props(f.planner.plan([...f.records, panel]), panel)['background-color'], '#fff')
})

test('light graphic on a whitened surface retains a visible edge', () => {
    const f = fixture()
    styled(f.nav, { 'background-color': black })
    const dot = styled(record('span', { parent: f.nav.node, hasText: false, rect: { width: 16, height: 16 } }), { 'background-color': white })
    const p = props(f.planner.plan([...f.records, dot]), dot)
    assert.match(p['box-shadow'], /inset/)
})

test('background-image sibling and overlay text enter the same protection scope', () => {
    const f = fixture()
    const panel = record('section', { parent: f.root.node, hasChildren: true })
    const photo = styled(record('div', { parent: panel.node }), { 'background-image': 'url("hero.png")', position: 'absolute' })
    const title = styled(record('h1', { parent: panel.node }), { color: white })
    const plans = f.planner.plan([...f.records, panel, photo, title])
    assert.equal(plans.get(panel.node).protected, true)
    assert.deepEqual(props(plans, title), {})
    assert.equal(plans.get(f.root.node).protected, false)
})

test('gradient-clipped pseudo text receives opaque replacement glyph paint', () => {
    const f = fixture()
    f.a.pseudos['::after'] = { content: '"Label"', color: clear, '-webkit-text-fill-color': clear,
        'background-image': 'linear-gradient(rgb(0,0,255),rgb(255,0,0))', 'background-clip': 'text' }
    const p = props(f.planner.plan(f.records), f.a, '::after')
    assert.equal(p['background-image'], 'none')
    assert.equal(p['-webkit-text-fill-color'], '#000')
})

test('border size and registered custom property transitions are not color suppression', () => {
    const p = Policy.transitionPlan({ property: 'all', duration: '1s' }, ['color', 'border-top-width', 'transform', '--position'])
    assert.equal(p['transition-property'], 'border-top-width,transform,--position')
})

test('a batch compiles an identical transition descriptor once for all nodes', () => {
    let calls = 0
    const get = Policy.createTransitionCache(['color', 'transform', 'opacity'], (style, props) => {
        calls++
        return Policy.transitionPlan(style, props)
    })
    const descriptor = { property: 'all', duration: '0.15s' }
    const first = get(descriptor)
    for (let i = 0; i < 1000; i++) assert.equal(get({ ...descriptor }), first)
    assert.equal(calls, 1)
    get({ ...descriptor, duration: '1s' })
    assert.equal(calls, 2)
})

test('transition cache includes custom property dependencies', () => {
    const get = Policy.createTransitionCache(['color', 'transform'])
    const a = get({ property: 'all', duration: '1s' }, ['--distance'])
    const b = get({ property: 'all', duration: '1s' }, ['--size'])
    assert.equal(a['transition-property'], 'transform,--distance')
    assert.equal(b['transition-property'], 'transform,--size')
})

test('zero-duration delayed paint does not keep a stale color during the delay', () => {
    const p = Policy.transitionPlan({ property: 'color, transform', duration: '0s', delay: '1s' }, [])
    assert.equal(p['transition-property'], 'transform')
    assert.equal(p['transition-delay'], '1s')
})

test('batch rule removal indexes the stylesheet once before deleting backwards', () => {
    const { layer, style } = layerFixture()
    for (let i = 0; i < 1000; i++) layer.set(String(i), `[data-id="${i}"]`, { color: '#000' })
    const rules = style.sheet.cssRules
    let reads = 0
    Object.defineProperty(style.sheet, 'cssRules', { get() { reads++; return rules } })
    layer.retain(new Set(['2', '500']))
    assert.equal(reads, 1)
    assert.equal(layer.stats().rules, 2)
    assert.deepEqual(rules.map(rule => rule.selectorText), ['[data-id="2"]', '[data-id="500"]'])
})

test('identical paints share one rule across a thousand live nodes', () => {
    const items = Array.from({ length: 1000 }, () => [{}, { rules: { '': { color: '#000', 'text-shadow': 'none' } } }])
    let allocations = 0
    const grouped = Dom.groupRules(items, new Map(), () => 'p' + (++allocations))
    assert.equal(allocations, 1)
    assert.equal(grouped.groups.size, 1)
    assert.equal(grouped.members.size, 1000)
    for (const values of grouped.members.values()) assert.deepEqual(values, ['p1'])
})

test('shared rule tokens survive changed membership and property insertion order', () => {
    const a = {}, b = {}
    const first = Dom.groupRules([[a, { rules: { '': { color: '#000', fill: '#000' } } }]], new Map(), () => 'p1')
    const previous = new Map([...first.groups].map(([key, value]) => [key, value.token]))
    const next = Dom.groupRules([[b, { rules: { '': { fill: '#000', color: '#000' } } }]], previous, () => { throw Error('Unnecessary token allocation') })
    assert.deepEqual(next.members.get(b), ['p1'])
})

test('a masked text field keeps contrasting glyphs instead of becoming a solid icon', () => {
    const f = fixture()
    const field = styled(record('textarea', { parent: f.root.node, focusable: true }), {
        'mask-image': 'linear-gradient(to left, transparent, white 10%)',
        '-webkit-mask-image': 'linear-gradient(to left, transparent, white 10%)'
    })
    const p = props(f.planner.plan([...f.records, field]), field)
    assert.equal(p.color, '#000')
    assert.notEqual(p['background-color'], '#000')
    assert.equal(p['caret-color'], '#000')
})

test('a transparent blurred header converts along with its text and unrelated content', () => {
    const f = fixture()
    const header = styled(record('header', { parent: f.root.node }), {
        'background-color': 'rgba(32, 40, 64, 0.9)', color: white,
        '-webkit-text-fill-color': white, 'backdrop-filter': 'blur(16px)'
    })
    const label = styled(record('span', { parent: header.node }), { color: white })
    const plans = f.planner.plan([...f.records, header, label])
    assert.equal(plans.get(header.node).protected, false)
    assert.equal(plans.get(label.node).protected, false)
    assert.equal(plans.get(f.root.node).protected, false)
    assert.equal(props(plans, f.a).color, '#000')
    assert.equal(props(plans, header).color, '#000')
    assert.equal(props(plans, header)['background-color'], '#fff')
    assert.equal(props(plans, label).color, '#000')
})

test('peer grouping is independent of sampling order at height and alignment boundaries', () => {
    const f = fixture()
    for (const r of [f.a, f.b]) styled(r, { color: white, 'background-color': 'rgba(210, 210, 215, 0.64)' })
    f.a.rect = { width: 44.8, height: 44.7999878, top: 5.6, left: 0 }
    f.b.rect = { width: 56, height: 56, top: 0, left: 100 }
    const first = f.planner.plan(f.records)
    const reversed = f.planner.plan([...f.records].reverse())
    assert.deepEqual(props(first, f.a), props(reversed, f.a))
    assert.deepEqual(props(first, f.b), props(reversed, f.b))
})

test('a viewport background canvas and an offscreen positioned link do not protect the document', () => {
    const root = styled(record('html', { hasChildren: true }), { color: white })
    const body = styled(record('body', { parent: root.node, hasChildren: true,
        rect: { width: 1024, height: 4000, left: 0, top: 0 } }), { color: white, 'background-color': 'rgb(11, 16, 14)' })
    const canvas = styled(record('canvas', { parent: body.node, hasText: false,
        rect: { width: 1024, height: 768, left: 0, top: 0 } }), { position: 'fixed' })
    const skip = styled(record('a', { parent: body.node, rect: { width: 160, height: 40, left: 0, top: -1000 } }), { position: 'absolute' })
    const main = record('main', { parent: body.node, hasChildren: true })
    const title = styled(record('h2', { parent: main.node }), { color: white })
    const plans = Policy.createPlanner(C).plan([root, body, canvas, skip, main, title])
    assert.equal(plans.get(body.node).protected, false)
    assert.equal(plans.get(main.node).protected, false)
    assert.equal(props(plans, body)['background-color'], '#fff')
    assert.equal(props(plans, title).color, '#000')
})

test('a page wrapper is not a local media surface merely because fixed foreground text overlaps a canvas', () => {
    const f = fixture()
    const wrapper = styled(record('div', { parent: f.root.node, hasChildren: true,
        rect: { width: 1024, height: 4000, left: 0, top: 0 } }), { 'background-color': black })
    const canvas = styled(record('canvas', { parent: wrapper.node, hasText: false,
        rect: { width: 1024, height: 768, left: 0, top: 0 } }), { position: 'fixed' })
    const floating = styled(record('aside', { parent: wrapper.node, rect: { width: 320, height: 128, left: 0, top: 0 } }), { position: 'fixed', color: white })
    const plans = f.planner.plan([...f.records, wrapper, canvas, floating])
    assert.equal(plans.get(wrapper.node).protected, false)
    assert.equal(props(plans, wrapper)['background-color'], '#fff')
    assert.equal(props(plans, floating).color, '#000')
})

test('hidden, transparent or nonoverlapping positioned text does not protect a media container', () => {
    for (const state of [{ visibility: 'hidden' }, { opacity: '0' }, { display: 'none' }, { outside: true }]) {
        const f = fixture()
        const panel = record('section', { parent: f.root.node, hasChildren: true })
        const photo = record('img', { parent: panel.node, hasText: false })
        const title = styled(record('h2', { parent: panel.node }), { position: 'absolute', color: white, ...state })
        if (state.outside) title.rect = { width: 120, height: 32, left: 500, top: 500 }
        const plans = f.planner.plan([...f.records, panel, photo, title])
        assert.equal(plans.get(panel.node).protected, false, JSON.stringify(state))
    }
})

test('a padded photo card preserves only real overlay text while its surrounding surface converts', () => {
    const f = fixture()
    const card = styled(record('article', { parent: f.root.node, hasChildren: true,
        rect: { width: 416, height: 248, left: 0, top: 0 } }), { 'background-color': black, position: 'relative' })
    const photo = record('img', { parent: card.node, hasText: false,
        rect: { width: 400, height: 200, left: 8, top: 8 } })
    const title = styled(record('h2', { parent: card.node,
        rect: { width: 240, height: 32, left: 16, top: 160 } }), { color: white, '-webkit-text-fill-color': white, position: 'absolute' })
    const detail = styled(record('p', { parent: card.node,
        rect: { width: 400, height: 32, left: 8, top: 216 } }), { color: white })
    const plans = f.planner.plan([...f.records, card, photo, title, detail])
    assert.equal(plans.get(card.node).protected, false)
    assert.equal(props(plans, card)['background-color'], '#fff')
    assert.equal(plans.get(title.node).protected, true)
    assert.equal(props(plans, title).color, white)
    assert.equal(props(plans, title)['background-color'], undefined)
    assert.equal(props(plans, detail).color, '#000')
})

test('a viewport-sized fixed canvas does not make a one-screen page wrapper a protected card', () => {
    const f = fixture()
    const wrapper = styled(record('div', { parent: f.root.node, hasChildren: true,
        rect: { width: 1024, height: 768, left: 0, top: 0 } }), { 'background-color': black })
    const canvas = styled(record('canvas', { parent: wrapper.node, hasText: false,
        rect: { width: 1024, height: 768, left: 0, top: 0 } }), { position: 'fixed' })
    const title = styled(record('h2', { parent: wrapper.node }), { position: 'absolute', color: white })
    const plans = f.planner.plan([...f.records, wrapper, canvas, title])
    assert.equal(plans.get(wrapper.node).protected, false)
    assert.equal(props(plans, title).color, '#000')
})

test('positioned native media fallback text is not a separate foreground overlay', () => {
    const f = fixture()
    const panel = record('article', { parent: f.root.node, hasChildren: true })
    const video = styled(record('video', { parent: panel.node, hasText: true }), { position: 'absolute' })
    const plans = f.planner.plan([...f.records, panel, video])
    assert.equal(plans.get(panel.node).protected, false)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const Policy = require('../src/contrast')
const { createDocument } = require('./helpers/contrast-document')
const { createPerformanceDocument } = require('./helpers/contrast-performance-document')

const white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
const normal = () => ({ color: white, '-webkit-text-fill-color': white, 'background-color': clear })
const glass = () => ({ ...normal(), 'background-color': 'rgba(11, 16, 14, 0.82)', 'backdrop-filter': 'blur(10px)', position: 'sticky' })

function record(tag, parent, style) {
    return { node: {}, tag, parent, hasText: true, hasChildren: false, rect: { left: 0, top: 0, width: 120, height: 32 },
        style: { ...normal(), 'background-image': 'none', display: 'block', visibility: 'visible', ...style }, pseudos: {} }
}

for (const background of ['rgba(11, 16, 14, 0.82)', clear]) {
    test(`backdrop-filter alone does not exempt a ${background === clear ? 'transparent' : 'translucent'} toolbar from contrast`, () => {
        const root = record('html', null, { 'background-color': white })
        const header = record('header', root.node, { ...glass(), 'background-color': background })
        header.hasChildren = true
        header.rect.width = 1280
        const label = record('span', header.node)
        const plans = Policy.createPlanner(C).plan([root, header, label])
        assert.equal(plans.get(header.node).protected, false)
        assert.equal(plans.get(label.node).protected, false)
        assert.equal(plans.get(header.node).rules['']['background-color'], '#fff')
        assert.equal(plans.get(label.node).rules[''].color, '#000')
        assert.equal(plans.get(header.node).rules['']['backdrop-filter'], undefined)
    })
}

test('a backdrop filter does not remove actual image and overlay protection', () => {
    const root = record('html', null, { 'background-color': white })
    const photo = record('section', root.node, { ...glass(), 'background-image': 'url("photo.png")' })
    const title = record('span', photo.node)
    const plans = Policy.createPlanner(C).plan([root, photo, title])
    assert.equal(plans.get(photo.node).protected, true)
    assert.equal(plans.get(title.node).protected, true)
    assert.equal(plans.get(photo.node).rules[''].color, white)
    assert.equal(plans.get(title.node).rules[''], undefined)
})

test('DOM conversion makes a glass toolbar white, updates its source and restores it on stop', () => {
    const f = createDocument()
    const header = f.element('header', f.doc.body, glass())
    header.rect.width = 1024
    const label = f.element('span', header, normal())
    f.start()
    assert.equal(f.painted(header)['background-color'], '#fff')
    assert.equal(f.painted(label).color, '#000')
    header.source['background-color'] = 'rgba(24, 32, 40, 0.6)'
    f.engine.invalidate(header); f.flush()
    assert.equal(f.painted(header)['background-color'], '#fff')
    assert.equal(f.painted(header)['backdrop-filter'], 'blur(10px)')
    header.source['background-color'] = clear
    header.source['backdrop-filter'] = 'none'
    f.engine.invalidate(header); f.flush()
    assert.equal(f.painted(header)['background-color'], clear)
    header.source['backdrop-filter'] = 'blur(10px)'
    f.engine.invalidate(header); f.flush()
    assert.equal(f.painted(header)['background-color'], '#fff')
    f.engine.stop()
    assert.equal(f.painted(header)['background-color'], clear)
    assert.equal(f.painted(header)['backdrop-filter'], 'blur(10px)')
    assert.equal(f.painted(label).color, white)
})

test('local state changes in a glass toolbar do not sample unrelated content', () => {
    const run = count => {
        const f = createPerformanceDocument()
        const header = f.element('header', f.doc.body, glass())
        const first = f.element('button', header, { ...normal(), 'background-color': 'rgb(20, 40, 30)' })
        const second = f.element('button', header, normal())
        first.setAttribute('aria-selected', 'true')
        second.rect.top = 40
        const article = f.element('article', f.doc.body)
        const unrelated = Array.from({ length: count }, () => f.element('p', article))
        f.start()
        first.setAttribute('aria-selected', 'false'); second.setAttribute('aria-selected', 'true')
        first.source = normal(); second.source = { ...normal(), 'background-color': 'rgb(20, 40, 30)' }
        f.resetCounts()
        f.doc.emit('click', second); f.flush()
        assert.equal(f.painted(header)['background-color'], '#fff')
        assert.equal(f.painted(second)['background-color'], '#000')
        assert.equal(f.painted(second).color, '#fff')
        assert.equal(unrelated.reduce((sum, el) => sum + f.readsFor(el), 0), 0)
        return f.counts()
    }
    const small = run(20), large = run(1000)
    assert.equal(large.sourceReads, small.sourceReads)
    assert.equal(large.hookWrites, small.hookWrites)
    assert.equal(large.outputRuleWrites, small.outputRuleWrites)
})

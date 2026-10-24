const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color')
const Policy = require('../src/high-contrast/contrast')

function field(paint = {}) {
    const node = {}, record = { node, tag: 'div', hasText: true, hasChildren: false, pseudos: {},
        rect: { width: 160, height: 32, left: 0, top: 0 }, style: {
            color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 255, 255)',
            'background-image': 'none', display: 'block', visibility: 'visible', ...paint } }
    return record
}

test('ordinary borders preserve decorative alpha below the existing one-half threshold on every side', () => {
    const record = field()
    for (const side of ['top', 'right', 'bottom', 'left']) Object.assign(record.style, {
        [`border-${side}-width`]: '1px', [`border-${side}-color`]: 'rgba(255, 255, 255, 0.49)'
    })
    const props = Policy.createPlanner(C).plan([record]).get(record.node).rules['']
    for (const side of ['top', 'right', 'bottom', 'left']) assert.equal(props[`border-${side}-color`], undefined)
})

test('border conversion starts at one-half alpha without enhancing zero-width or transparent sides', () => {
    const record = field({ 'border-top-width': '1px', 'border-top-color': 'rgba(255, 255, 255, 0.5)',
        'border-right-width': '0px', 'border-right-color': 'rgb(255, 255, 255)',
        'border-bottom-width': '1px', 'border-bottom-color': 'rgba(255, 255, 255, 0)',
        'border-left-width': '1px', 'border-left-color': 'rgb(255, 255, 255)' })
    const props = Policy.createPlanner(C).plan([record]).get(record.node).rules['']
    assert.equal(props['border-top-color'], '#000')
    assert.equal(props['border-left-color'], '#000')
    assert.equal(props['border-right-color'], undefined)
    assert.equal(props['border-bottom-color'], undefined)
})

test('pseudo borders keep the same decorative alpha and per-side width contract', () => {
    const record = field()
    record.pseudos['::before'] = { content: '""', color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)',
        'border-top-width': '1px', 'border-top-color': 'rgba(255, 255, 255, 0.49)',
        'border-right-width': '0px', 'border-right-color': 'rgb(255, 255, 255)',
        'border-bottom-width': '1px', 'border-bottom-color': 'rgba(255, 255, 255, 0)',
        'border-left-width': '1px', 'border-left-color': 'rgba(255, 255, 255, 0.5)' }
    const props = Policy.createPlanner(C).plan([record]).get(record.node).rules['::before']
    assert.equal(props['border-top-color'], undefined)
    assert.equal(props['border-right-color'], undefined)
    assert.equal(props['border-bottom-color'], undefined)
    assert.equal(props['border-left-color'], '#000')
})

test('base paint keeps native controls selection and all scrollbar surfaces in the light scheme', () => {
    assert.deepEqual(Policy.BASE_RULES[':root'], { 'color-scheme': 'light', 'scrollbar-color': '#000 #fff' })
    assert.deepEqual(Policy.BASE_RULES['::selection'], { 'background-color': '#000', color: '#fff' })
    assert.equal(Policy.BASE_RULES['::-webkit-scrollbar-track']['background-color'], '#fff')
    assert.equal(Policy.BASE_RULES['::-webkit-scrollbar-thumb']['background-color'], '#000')
    assert.equal(Policy.BASE_RULES['::-webkit-scrollbar-corner']['background-color'], '#fff')
})

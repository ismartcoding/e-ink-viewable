const test = require('node:test')
const assert = require('node:assert/strict')
const { createRuleLayer } = require('../src/high-contrast/contrast-dom')

function fixture() {
    let toggles = 0, disabled = false
    const sheet = { cssRules: [], get disabled() { return disabled }, set disabled(value) { disabled = value; toggles++ },
        insertRule(text, index) {
            const brace = text.indexOf('{'), rule = { selectorText: text.slice(0, brace), style: { cssText: text.slice(brace + 1, -1) } }
            this.cssRules.splice(index, 0, rule)
            return index
        }, deleteRule(index) { this.cssRules.splice(index, 1) } }
    const element = { isConnected: true, sheet, remove() { this.isConnected = false; sheet.cssRules.length = 0 } }
    const root = { nodeType: 9, createElement: () => element, documentElement: { appendChild() { element.isConnected = true } } }
    const layer = createRuleLayer(root, new WeakSet())
    return { layer, sheet, element, toggles: () => toggles }
}

test('source sampling clears only requested output groups and leaves the stylesheet enabled', () => {
    const f = fixture()
    f.layer.set('nav', '[data-nav]', { color: '#fff' })
    f.layer.set('article', '[data-article]', { color: '#000' })
    f.layer.set('base', ':root', { 'color-scheme': 'light' })
    const before = f.sheet.cssRules.map(rule => rule.style.cssText), writes = f.layer.stats().writes
    f.layer.pause(['nav'])
    assert.equal(f.sheet.cssRules[0].style.cssText, '')
    assert.deepEqual(f.sheet.cssRules.slice(1).map(rule => rule.style.cssText), before.slice(1))
    assert.equal(f.layer.stats().writes, writes)
    assert.equal(f.layer.stats().samplingWrites, 1)
    f.layer.resume()
    assert.deepEqual(f.sheet.cssRules.map(rule => rule.style.cssText), before)
    assert.equal(f.layer.stats().samplingWrites, 2)
    assert.equal(f.layer.stats().writes, writes)
    assert.equal(f.toggles(), 0)
})

test('repeated nodes in the same sampling group cause one clear and one restoration', () => {
    const f = fixture()
    for (let i = 0; i < 1000; i++) f.layer.set('p' + i, '[data-id="' + i + '"]', { color: '#000' })
    f.layer.pause(Array(1000).fill('p7'))
    f.layer.pause(['p7', 'missing'])
    assert.equal(f.sheet.cssRules.filter(rule => !rule.style.cssText).length, 1)
    assert.equal(f.layer.stats().samplingWrites, 1)
    f.layer.resume(); f.layer.resume()
    assert.equal(f.layer.stats().samplingWrites, 2)
    assert.equal(f.layer.stats().writes, 1000)
    assert.equal(f.toggles(), 0)
})

test('changed output plans remain paused and restoration uses their latest cached paint', () => {
    const f = fixture()
    f.layer.set('p1', '[data-id="1"]', { color: '#000' })
    f.layer.pause(['p1'])
    f.layer.set('p1', '[data-id="2"]', { color: '#fff' })
    assert.equal(f.sheet.cssRules[0].style.cssText, '')
    assert.equal(f.sheet.cssRules[0].selectorText, '[data-id="2"]')
    f.layer.resume()
    assert.equal(f.sheet.cssRules[0].style.cssText, 'color:#fff!important')
    assert.equal(f.layer.stats().samplingWrites, 2)
    assert.equal(f.layer.stats().writes, 2)
})

test('removed sampling groups never reappear during restoration', () => {
    for (const remove of [layer => layer.retain(new Set()), layer => layer.set('p1', '', {})]) {
        const f = fixture()
        f.layer.set('p1', '[data-id="1"]', { color: '#000' })
        f.layer.pause(['p1'])
        remove(f.layer)
        f.layer.resume()
        assert.equal(f.sheet.cssRules.length, 0)
        assert.equal(f.layer.stats().rules, 0)
        assert.equal(f.layer.stats().samplingWrites, 1)
    }
})

test('reattaching a removed style while sampling preserves the paused state until restoration', () => {
    const f = fixture()
    f.layer.set('p1', '[data-id="1"]', { color: '#000' })
    f.layer.pause(['p1'])
    f.element.remove()
    f.layer.attach()
    assert.equal(f.sheet.cssRules.length, 1)
    assert.equal(f.sheet.cssRules[0].style.cssText, '')
    f.layer.resume()
    assert.equal(f.sheet.cssRules[0].style.cssText, 'color:#000!important')
    assert.equal(f.layer.stats().samplingWrites, 2)
})

test('guard layers retain explicit disable support without recording sampling mutations', () => {
    const f = fixture()
    f.layer.disable(true)
    assert.equal(f.sheet.disabled, true)
    f.layer.disable(false)
    assert.equal(f.sheet.disabled, false)
    assert.equal(f.toggles(), 2)
    assert.equal(f.layer.stats().samplingWrites, 0)
})

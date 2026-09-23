const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color.js')

test('parseRgb reads comma, space and slash forms', () => {
    assert.deepStrictEqual(C.parseRgb('rgb(13, 17, 23)'), { r: 13, g: 17, b: 23, a: 1 })
    assert.deepStrictEqual(C.parseRgb('rgb(13 17 23)'), { r: 13, g: 17, b: 23, a: 1 })
    assert.deepStrictEqual(C.parseRgb('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 })
    assert.deepStrictEqual(C.parseRgb('rgb(0 0 0 / 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 })
    assert.deepStrictEqual(C.parseRgb('rgb(0 0 0 / 50%)'), { r: 0, g: 0, b: 0, a: 0.5 })
    assert.strictEqual(C.parseRgb('none'), null)
    assert.strictEqual(C.parseRgb(''), null)
    assert.strictEqual(C.parseRgb(undefined), null)
})

test('backgrounds: dark becomes white, everything else is left alone', () => {
    assert.strictEqual(C.newBackgroundColor('rgb(13, 17, 23)'), '#fff')            // github dark canvas
    assert.strictEqual(C.newBackgroundColor('rgba(0, 0, 0, 0.85)'), 'rgba(255, 255, 255, 0.85)')
    assert.strictEqual(C.newBackgroundColor('rgb(127, 127, 127)'), '#fff')          // boundary: below 128
    assert.strictEqual(C.newBackgroundColor('rgb(128, 128, 128)'), null)            // boundary: 128 stays
    assert.strictEqual(C.newBackgroundColor('rgb(255, 255, 255)'), null)
    assert.strictEqual(C.newBackgroundColor('rgb(255, 215, 0)'), null)              // yellow warning stays
    assert.strictEqual(C.newBackgroundColor('rgba(0, 0, 0, 0)'), null)              // transparent stays
    assert.strictEqual(C.newBackgroundColor('rgba(13, 17, 23, 0.3)'), null)         // faint overlay stays
})

test('text: only colors meant for dark backgrounds become black', () => {
    assert.strictEqual(C.newTextColor('rgb(255, 255, 255)'), '#000')
    assert.strictEqual(C.newTextColor('rgb(201, 209, 217)'), '#000')                // github dark text
    assert.strictEqual(C.newTextColor('rgb(166, 166, 166)'), '#000')                // boundary
    assert.strictEqual(C.newTextColor('rgb(165, 165, 165)'), null)                  // boundary
    assert.strictEqual(C.newTextColor('rgb(139, 148, 158)'), null)                  // github secondary text kept
    assert.strictEqual(C.newTextColor('rgb(9, 105, 218)'), null)                    // link blue kept
    assert.strictEqual(C.newTextColor('rgb(3, 102, 214)'), null)                    // accent blue kept
    assert.strictEqual(C.newTextColor('rgb(153, 153, 153)'), null)                  // common gray kept
    assert.strictEqual(C.newTextColor('rgb(210, 36, 33)'), null)                    // red kept
})

test('borders: near-invisible ones darken, the rest keep their color', () => {
    assert.strictEqual(C.newBorderColor('rgb(208, 215, 222)'), '#000')              // light theme border
    assert.strictEqual(C.newBorderColor('rgb(171, 171, 171)'), '#000')              // boundary
    assert.strictEqual(C.newBorderColor('rgb(170, 170, 170)'), null)                // boundary
    assert.strictEqual(C.newBorderColor('rgb(48, 54, 61)'), null)                   // dark theme border kept
    assert.strictEqual(C.newBorderColor('rgb(153, 153, 153)'), null)
    assert.strictEqual(C.newBorderColor('rgb(208, 215, 222) rgb(48, 54, 61) rgb(48, 54, 61) rgb(48, 54, 61)'), '#000')
})

test('gradients: dark ones are cleared, light ones and images stay', () => {
    assert.strictEqual(C.hasDarkGradient('linear-gradient(rgb(29, 30, 32), rgb(64, 66, 71))'), true)
    assert.strictEqual(C.hasDarkGradient('radial-gradient(rgb(255, 255, 255), rgb(64, 66, 71))'), true)
    assert.strictEqual(C.hasDarkGradient('linear-gradient(rgb(255, 255, 255), rgb(240, 240, 240))'), false)
    assert.strictEqual(C.hasDarkGradient('linear-gradient(rgb(255, 255, 255), url(x))'), false)
    assert.strictEqual(C.hasDarkGradient('url("https://example.com/bg.png")'), false)
    assert.strictEqual(C.hasDarkGradient('none'), false)
    assert.strictEqual(C.hasDarkGradient(''), false)
})

test('svg paint: white flips to currentColor, colored icons are kept', () => {
    assert.strictEqual(C.newFillColor('rgb(255, 255, 255)'), 'currentColor')
    assert.strictEqual(C.newFillColor('rgb(166, 166, 166)'), 'currentColor')        // boundary
    assert.strictEqual(C.newFillColor('rgb(165, 165, 165)'), null)                  // boundary
    assert.strictEqual(C.newFillColor('rgb(36, 41, 47)'), null)                     // dark icon kept
    assert.strictEqual(C.newFillColor('rgb(218, 54, 51)'), null)                    // red icon kept
    assert.strictEqual(C.newFillColor('none'), null)
})

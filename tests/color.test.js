const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color.js')

function closeTo(actual, expected, tolerance, message) {
    assert.ok(actual && Math.abs(actual.r - expected.r) <= tolerance &&
        Math.abs(actual.g - expected.g) <= tolerance &&
        Math.abs(actual.b - expected.b) <= tolerance,
    message + ` (got ${actual && JSON.stringify(actual)})`)
}

test('parseColor reads legacy and modern rgb forms', () => {
    assert.deepStrictEqual(C.parseColor('rgb(13, 17, 23)'), { r: 13, g: 17, b: 23, a: 1 })
    assert.deepStrictEqual(C.parseColor('rgb(13 17 23)'), { r: 13, g: 17, b: 23, a: 1 })
    assert.deepStrictEqual(C.parseColor('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 })
    assert.deepStrictEqual(C.parseColor('rgb(0 0 0 / 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 })
    assert.deepStrictEqual(C.parseColor('rgb(0 0 0 / 50%)'), { r: 0, g: 0, b: 0, a: 0.5 })
    assert.strictEqual(C.parseColor('none'), null)
    assert.strictEqual(C.parseColor(''), null)
    assert.strictEqual(C.parseColor(undefined), null)
})

test('parseColor converts the color spaces Chrome reports for modern sites', () => {
    // Real computed value from plainapp.app's header (Tailwind v4 color-mix).
    closeTo(C.parseColor('oklab(0.171762 0.00647315 -0.0281512 / 0.8)'), { r: 14, g: 14, b: 28, a: 0.8 }, 3, 'oklab from plainapp.app')
    closeTo(C.parseColor('oklch(0.21 0.006 285.885)'), { r: 24, g: 24, b: 27, a: 1 }, 3, 'tailwind zinc-900')
    closeTo(C.parseColor('oklch(0.627955 0.257683 29.2338)'), { r: 255, g: 0, b: 0, a: 1 }, 3, 'css color 4 red sample')
    closeTo(C.parseColor('oklch(97.1% .013 17.38)'), { r: 254, g: 242, b: 242, a: 1 }, 1, 'tailwind red-50 (percent lightness)')
    closeTo(C.parseColor('hsl(0 0% 10%)'), { r: 26, g: 26, b: 26, a: 1 }, 1, 'hsl dark gray')
    closeTo(C.parseColor('hsla(120, 100%, 50%, 0.5)'), { r: 0, g: 255, b: 0, a: 0.5 }, 1, 'legacy hsla green')
    closeTo(C.parseColor('hwb(0 0% 0%)'), { r: 255, g: 0, b: 0, a: 1 }, 1, 'hwb red')
    closeTo(C.parseColor('lab(100% 0 0)'), { r: 255, g: 255, b: 255, a: 1 }, 2, 'lab white')
    closeTo(C.parseColor('lab(54.29% 80.8 69.89)'), { r: 255, g: 0, b: 0, a: 1 }, 5, 'lab red')
    closeTo(C.parseColor('lch(54.29% 106.9 40.85)'), { r: 255, g: 0, b: 0, a: 1 }, 5, 'lch red')
    closeTo(C.parseColor('color(srgb 0.055 0.055 0.11 / 0.8)'), { r: 14, g: 14, b: 28, a: 0.8 }, 2, 'color srgb with alpha')
    // display-p3 red is outside srgb; naive clip keeps it a dark saturated red,
    // which is all the brightness decision needs.
    const p3red = C.parseColor('color(display-p3 1 0 0)')
    assert.ok(p3red && p3red.r >= 230 && p3red.g <= 60 && p3red.b <= 60, 'display-p3 red stays dark red')
    closeTo(C.parseColor('oklch(0.2 none 0)'), { r: 22, g: 22, b: 22, a: 1 }, 2, 'none channel counts as 0')
    assert.strictEqual(C.parseColor('oklch(0.2 abc 0)'), null) // invalid channel → leave alone
})

test('backgrounds: dark becomes white, everything else is left alone', () => {
    assert.strictEqual(C.newBackgroundColor('rgb(13, 17, 23)'), '#fff')            // github dark canvas
    assert.strictEqual(C.newBackgroundColor('oklab(0.171762 0.00647315 -0.0281512 / 0.8)'), 'rgba(255, 255, 255, 0.8)') // plainapp.app header
    assert.strictEqual(C.newBackgroundColor('oklch(0.21 0.006 285.885)'), '#fff')  // tailwind zinc-900
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
    assert.strictEqual(C.hasDarkGradient('linear-gradient(oklch(0.21 0.006 285.885), oklch(0.985 0 0))'), true) // tailwind v4 stops
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

test('box-shadows: colored ones turn black in place, black ones and none stay', () => {
    assert.strictEqual(C.newBoxShadow('none'), null)
    assert.strictEqual(C.newBoxShadow(''), null)
    assert.strictEqual(C.newBoxShadow(undefined), null)
    assert.strictEqual(C.newBoxShadow('rgba(0, 0, 0, 0.1) 0px 1px 3px 0px'), null) // already black
    assert.strictEqual(C.newBoxShadow('rgb(0, 0, 0) 0px 0px 0px 1px inset'), null) // black inset
    assert.strictEqual(C.newBoxShadow('rgb(255, 0, 0) 0px 4px 12px 0px'), '#000 0px 4px 12px 0px')
    assert.strictEqual(C.newBoxShadow('rgba(59, 130, 246, 0.3) 0px 4px 12px 0px'), 'rgba(0, 0, 0, 0.3) 0px 4px 12px 0px') // alpha kept
    assert.strictEqual(C.newBoxShadow('oklch(0.7 0.15 250) 0px 0px 8px'), '#000 0px 0px 8px') // tailwind v4 palette
    assert.strictEqual(C.newBoxShadow('rgba(59, 130, 246, 0.3) 0px 4px 12px 0px, rgb(0, 0, 0) 0px 1px 2px 0px inset'), 'rgba(0, 0, 0, 0.3) 0px 4px 12px 0px, rgb(0, 0, 0) 0px 1px 2px 0px inset')
})

test('gradientAverageBrightness classifies gradient text paint', () => {
    const light = C.gradientAverageBrightness('linear-gradient(rgb(255, 255, 255), rgb(255, 214, 236))')
    assert.ok(light > 200, 'light gradient avg > 200, got ' + light)
    const dark = C.gradientAverageBrightness('linear-gradient(rgb(64, 66, 71), rgb(29, 30, 32))')
    assert.ok(dark < 128, 'dark gradient avg < 128, got ' + dark)
    assert.equal(C.gradientAverageBrightness('url("paint.png")'), null)
    assert.equal(C.gradientAverageBrightness('none'), null)
    assert.equal(C.gradientAverageBrightness(''), null)
})

test('background kind: image wins, opaque colors classify, transparent inherits', () => {
    assert.strictEqual(C.backgroundKind('rgba(0, 0, 0, 0)', 'url("banner.jpg")'), 'image')
    assert.strictEqual(C.backgroundKind('rgba(0, 0, 0, 0)', 'linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6)), url("banner.jpg")'), 'image')
    assert.strictEqual(C.backgroundKind('rgb(13, 17, 23)', 'none'), 'dark')
    assert.strictEqual(C.backgroundKind('rgb(239, 239, 239)', 'none'), 'light')
    assert.strictEqual(C.backgroundKind('rgba(0, 0, 0, 0)', 'none'), null)
    assert.strictEqual(C.backgroundKind('rgba(13, 17, 23, 0.3)', 'none'), null)     // faint overlay inherits
})

test('backgroundShade: dark and light surfaces, transparent and junk are null', () => {
    assert.equal(C.backgroundShade('rgb(13, 17, 23)'), 'dark')
    assert.equal(C.backgroundShade('rgba(0, 0, 0, 0.85)'), 'dark')
    assert.equal(C.backgroundShade('rgb(249, 249, 250)'), 'light')
    assert.equal(C.backgroundShade('rgba(255, 255, 255, 0.4)'), null) // too transparent to count
    assert.equal(C.backgroundShade('none'), null)
    assert.equal(C.backgroundShade(''), null)
})

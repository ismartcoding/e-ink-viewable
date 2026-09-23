// Color decisions for converting dark-themed pages to an e-ink friendly
// light theme. Pure functions only — no DOM, no chrome APIs — so they can be
// unit tested directly (tests/color.test.js).
//
// The rule everywhere is "change as little as possible": a color is rewritten
// only when it was clearly designed for a dark background and would break on
// white. Anything else (links, accents, mid grays, light pages) keeps the
// page's own color.

// AERT perceived brightness: 0 (black) – 255 (white).
function brightness(color) {
    return (color.r * 299 + color.g * 587 + color.b * 114) / 1000
}

// Computed colors serialize as rgb()/rgba(), in comma form or the Color-4
// space/slash form. Returns null for anything unparseable; callers treat null
// as "leave the page's color alone".
const RGB_RE = /rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)(?:[,\s/]+([\d.]+%?))?\s*\)/

function parseRgb(text) {
    if (!text) return null
    const m = RGB_RE.exec(String(text))
    if (!m) return null
    let a = 1
    if (m[4] !== undefined) {
        a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    }
    return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), a }
}

const DARK = 128        // backgrounds darker than this get flipped to white
const MIN_ALPHA = 0.5   // nearly transparent colors are decorative, leave them
const LIGHT_TEXT = 165  // text lighter than this was meant for a dark background
const LIGHT_BORDER = 170

// 'rgb(13, 17, 23)' → '#fff'; a translucent dark overlay keeps its translucency.
function newBackgroundColor(backgroundColor) {
    const c = parseRgb(backgroundColor)
    if (!c || c.a < MIN_ALPHA || brightness(c) >= DARK) return null
    return c.a >= 1 ? '#fff' : `rgba(255, 255, 255, ${c.a})`
}

// 'rgb(255, 255, 255)' → '#000'; everything darker keeps the page's color.
function newTextColor(color) {
    const c = parseRgb(color)
    if (!c || c.a < MIN_ALPHA || brightness(c) <= LIGHT_TEXT) return null
    return '#000'
}

// Near-invisible borders (e.g. #d0d7de) darken to black; dark and colored
// borders stay. borderColor may list four sides — the first one decides.
function newBorderColor(borderColor) {
    const c = parseRgb(borderColor)
    if (!c || c.a < MIN_ALPHA || brightness(c) <= LIGHT_BORDER) return null
    return '#000'
}

// White svg fills/strokes would vanish on a white background; colored icons
// keep their color (currentColor follows the, possibly flipped, text color).
function newFillColor(fill) {
    const c = parseRgb(fill)
    if (!c || c.a < MIN_ALPHA || brightness(c) <= LIGHT_TEXT) return null
    return 'currentColor'
}

// Dark gradients become flat white; light gradients and url() backgrounds
// (photos, sprites) are left alone.
function hasDarkGradient(backgroundImage) {
    const text = String(backgroundImage || '')
    if (!text || text === 'none' || text.includes('url(') || !text.includes('gradient')) return false
    const tokens = text.match(/rgba?\([^)]*\)/g) || []
    return tokens.some(token => {
        const c = parseRgb(token)
        return c && brightness(c) < DARK
    })
}

const EinkColor = {
    brightness,
    parseRgb,
    newBackgroundColor,
    newTextColor,
    newBorderColor,
    newFillColor,
    hasDarkGradient
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EinkColor
} else {
    globalThis.EinkColor = EinkColor
}

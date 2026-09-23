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

// ---------------------------------------------------------------------------
// CSS color parsing.
//
// getComputedStyle preserves the color space a site used: legacy rgb()/rgba()
// stays rgb(), but Tailwind v4 opacity modifiers compile to color-mix(in
// oklab, …) and Chrome reports the result as oklab(.../a); palettes and
// gradients come back as oklch(), lab(), color(srgb …) and friends. All of
// those must parse, or modern sites stay dark. Results are normalized to
// 8-bit srgb {r,g,b,a}; anything unparseable returns null and callers leave
// the page's color alone.

const COLOR_RE = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^)]*)\)$/i
const COLOR_TOKEN_RE = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi
const DEG = Math.PI / 180

const cache = new Map()

function unit(token, max) {
    if (token === undefined || token === null) return NaN
    const t = token.trim()
    if (t === 'none') return 0
    if (t.endsWith('%')) return parseFloat(t) / 100 * max
    const n = parseFloat(t)
    return isNaN(n) ? NaN : n
}

function hue(token) {
    if (token === undefined || token === null) return NaN
    const t = token.trim().toLowerCase()
    const n = parseFloat(t)
    if (isNaN(n)) return NaN
    if (t.endsWith('grad')) return n * 0.9
    if (t.endsWith('rad')) return n * 180 / Math.PI
    if (t.endsWith('turn')) return n * 360
    return n // deg or unitless
}

function clamp01(c) {
    return c < 0 ? 0 : c > 1 ? 1 : c
}

function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function hslToLinear(h, s, l) {
    const f = n => {
        const k = (n + h / 30) % 12
        const a = s * Math.min(l, 1 - l)
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    }
    return [srgbToLinear(f(0)), srgbToLinear(f(8)), srgbToLinear(f(4))]
}

function hwbToLinear(h, w, b) {
    if (w + b >= 1) {
        const g = srgbToLinear(w / (w + b))
        return [g, g, g]
    }
    return hslToLinear(h, 1, 0.5).map(c => c * (1 - w - b) + srgbToLinear(w))
}

// OKLab → linear sRGB (Björn Ottosson's matrices).
function oklabToLinear(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b
    const l = l_ * l_ * l_
    const m = m_ * m_ * m_
    const s = s_ * s_ * s_
    return [
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ]
}

// CIE Lab (D50 white) → linear sRGB.
function labToLinear(L, a, b) {
    const fy = (L + 16) / 116
    const fx = fy + a / 500
    const fz = fy - b / 200
    const inv = 6 / 29
    const f = t => (t > inv ? t * t * t : 3 * inv * inv * (t - 4 / 29))
    const X = f(fx) * 0.96422
    const Y = f(fy)
    const Z = f(fz) * 0.82521
    // Bradford D50 → D65, then XYZ (D65) → linear sRGB.
    const x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z
    const y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z
    const z = 0.0122982 * X - 0.0204830 * Y + 1.3299098 * Z
    return [
        3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
        -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
        0.0556434 * x - 0.2040259 * y + 1.0572252 * z
    ]
}

// Display P3 → linear sRGB.
function p3ToLinear(r, g, b) {
    const x = 0.4865709486 * r + 0.2656676932 * g + 0.1982172852 * b
    const y = 0.2289745641 * r + 0.6917385218 * g + 0.0792869141 * b
    const z = 0.0451133819 * g + 1.0439443689 * b
    return [
        3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
        -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
        0.0556434 * x - 0.2040259 * y + 1.0572252 * z
    ]
}

function parseColorUncached(input) {
    const m = COLOR_RE.exec(input)
    if (!m) return null
    const name = m[1].toLowerCase()
    const args = m[2].trim().split(/[\s,/]+/).filter(t => t !== '')
    const channels = name === 'color' ? 4 : 3
    let alpha = 1
    if (args.length === channels + 1) alpha = unit(args.pop(), 1)
    if (args.length !== channels || isNaN(alpha)) return null

    let linear
    if (name === 'rgb' || name === 'rgba') {
        linear = [unit(args[0], 255), unit(args[1], 255), unit(args[2], 255)].map(c => srgbToLinear(c / 255))
    } else if (name === 'hsl' || name === 'hsla') {
        linear = hslToLinear(hue(args[0]), clamp01(unit(args[1], 1)), clamp01(unit(args[2], 1)))
    } else if (name === 'hwb') {
        linear = hwbToLinear(hue(args[0]), clamp01(unit(args[1], 1)), clamp01(unit(args[2], 1)))
    } else if (name === 'lab') {
        linear = labToLinear(unit(args[0], 100), unit(args[1], 125), unit(args[2], 125))
    } else if (name === 'lch') {
        const c = unit(args[1], 150)
        const h = hue(args[2]) * DEG
        linear = labToLinear(unit(args[0], 100), c * Math.cos(h), c * Math.sin(h))
    } else if (name === 'oklab') {
        linear = oklabToLinear(unit(args[0], 1), unit(args[1], 0.4), unit(args[2], 0.4))
    } else if (name === 'oklch') {
        const c = unit(args[1], 0.4)
        const h = hue(args[2]) * DEG
        linear = oklabToLinear(unit(args[0], 1), c * Math.cos(h), c * Math.sin(h))
    } else { // color()
        const profile = args[0].toLowerCase()
        const c = [unit(args[1], 1), unit(args[2], 1), unit(args[3], 1)]
        if (c.some(isNaN)) return null
        if (profile === 'srgb') linear = c.map(srgbToLinear)
        else if (profile === 'srgb-linear' || profile === 'xyz-d65') linear = c
        else if (profile === 'display-p3') linear = p3ToLinear(c[0], c[1], c[2])
        else linear = c.map(srgbToLinear) // unknown profile: approximate as srgb
    }

    if (linear.some(isNaN)) return null
    return {
        r: Math.round(linearToSrgb(clamp01(linear[0])) * 255),
        g: Math.round(linearToSrgb(clamp01(linear[1])) * 255),
        b: Math.round(linearToSrgb(clamp01(linear[2])) * 255),
        a: alpha
    }
}

// 'rgb(13, 17, 23)' / 'oklab(0.17 0.006 -0.028 / 0.8)' → {r,g,b,a}; null for
// anything unparseable. Parsed values are cached — the same computed strings
// recur across thousands of elements. A four-sided border-color like
// 'rgb(a) rgb(b) rgb(c) rgb(d)' falls back to its first token.
function parseColor(text) {
    if (!text) return null
    const input = String(text).trim()
    let parsed = cache.get(input)
    if (parsed === undefined) {
        parsed = parseColorUncached(input)
        if (parsed === null) {
            const token = input.match(COLOR_TOKEN_RE)
            if (token) parsed = parseColorUncached(token[0])
        }
        cache.set(input, parsed)
        if (cache.size > 4096) cache.clear()
    }
    return parsed
}

const DARK = 128        // backgrounds darker than this get flipped to white
const MIN_ALPHA = 0.5   // nearly transparent colors are decorative, leave them
const LIGHT_TEXT = 165  // text lighter than this was meant for a dark background
const LIGHT_BORDER = 170

// 'rgb(13, 17, 23)' → '#fff'; a translucent dark overlay keeps its translucency.
function newBackgroundColor(backgroundColor) {
    const c = parseColor(backgroundColor)
    if (!c || c.a < MIN_ALPHA || brightness(c) >= DARK) return null
    return c.a >= 1 ? '#fff' : `rgba(255, 255, 255, ${c.a})`
}

// 'rgb(255, 255, 255)' → '#000'; everything darker keeps the page's color.
function newTextColor(color) {
    const c = parseColor(color)
    if (!c || c.a < MIN_ALPHA || brightness(c) <= LIGHT_TEXT) return null
    return '#000'
}

// Near-invisible borders (e.g. #d0d7de) darken to black; dark and colored
// borders stay. borderColor may list four sides — the first one decides.
function newBorderColor(borderColor) {
    const c = parseColor(borderColor)
    if (!c || c.a < MIN_ALPHA || brightness(c) <= LIGHT_BORDER) return null
    return '#000'
}

// White svg fills/strokes would vanish on a white background; colored icons
// keep their color (currentColor follows the, possibly flipped, text color).
function newFillColor(fill) {
    const c = parseColor(fill)
    if (!c || c.a < MIN_ALPHA || brightness(c) <= LIGHT_TEXT) return null
    return 'currentColor'
}

// Dark gradients become flat white; light gradients and url() backgrounds
// (photos, sprites) are left alone.
function hasDarkGradient(backgroundImage) {
    const text = String(backgroundImage || '')
    if (!text || text === 'none' || text.includes('url(') || !text.includes('gradient')) return false
    const tokens = text.match(COLOR_TOKEN_RE) || []
    return tokens.some(token => {
        const c = parseColor(token)
        return c && brightness(c) < DARK
    })
}

// What an element effectively sits on, judging only its own background (the
// caller walks up the parent chain for 'null'): a url() image — including the
// classic dark gradient-over-photo banner — means the site designed its text
// against that image, so the text must keep its color; an opaque color is
// classified dark/light; transparent inherits.
function backgroundKind(backgroundColor, backgroundImage) {
    const image = String(backgroundImage || '')
    if (image.includes('url(')) return 'image'
    const c = parseColor(backgroundColor)
    if (c && c.a >= MIN_ALPHA) return brightness(c) < DARK ? 'dark' : 'light'
    return null
}

const EinkColor = {
    brightness,
    parseColor,
    newBackgroundColor,
    newTextColor,
    newBorderColor,
    newFillColor,
    hasDarkGradient,
    backgroundKind
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EinkColor
} else {
    globalThis.EinkColor = EinkColor
}

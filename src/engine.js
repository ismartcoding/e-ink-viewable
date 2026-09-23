// E-ink conversion engine.
//
// Owns every conversion decision that needs the DOM: which elements are
// skipped, what an element effectively sits on, which inline styles to write,
// batching, mutation handling and hover handling. It knows nothing about
// chrome APIs or pages: computed styles and frame scheduling are injected, so
// tests can drive it on fake elements (tests/engine.test.js).
//
// Contract:
// - computed styles are read for a whole batch before any style is written
//   (mixing the two forces a style recalc per element and janks the page),
// - elements are processed once each, in animation-frame batches,
// - over a background image the site's own text/border/svg colors are kept —
//   only opaque dark backgrounds are rewritten,
// - the mutation path filters to added element nodes, so our own inline
//   style writes can never feed back into it.

const SKIP_TAGS = new Set([
    'head', 'script', 'style', 'link', 'meta', 'title', 'base', 'noscript',
    'template', 'br', 'wbr'
])

// Elements that render their own pixels; text color is meaningless for them.
const NO_TEXT_TAGS = new Set([
    'img', 'picture', 'source', 'video', 'audio', 'canvas', 'iframe',
    'embed', 'object'
])

// Inside an <svg> only painted shapes matter; skip <defs>, filters, etc.
const SVG_SHAPES = new Set([
    'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline',
    'polygon', 'text', 'tspan', 'use'
])

// Color-only stylesheet: native widgets/scrollbars follow a light scheme,
// selection and scrollbars stay readable on e-ink. Nothing here changes
// layout or size.
const STYLE_TEXT = `
:root { color-scheme: light !important; scrollbar-color: #000 #fff !important; }
::-webkit-scrollbar-track { background-color: #fff !important; }
::-webkit-scrollbar-thumb { background-color: #000 !important; }
::-webkit-scrollbar-corner { background-color: #fff !important; }
::selection { background-color: #000 !important; color: #fff !important; }`

const MAX_HOVER_CHAIN = 32

function createEngine(C, { styles, schedule, batchSize = 300 }) {
    const seen = new WeakSet()
    const queue = new Set()
    const bgKind = new WeakMap() // element → 'image' | 'dark' | 'light' | null
    let scheduled = false

    function skip(el) {
        if (el.nodeType !== 1) return true
        const tag = el.tagName.toLowerCase()
        if (SKIP_TAGS.has(tag)) return true
        if (el.ownerSVGElement && !SVG_SHAPES.has(tag)) return true
        return false
    }

    // Own background first; transparent falls through to the nearest
    // processed ancestor (parents are always processed before their children:
    // document order in the load pass, explicit order in the hover pass).
    function resolveKind(el, cs) {
        const own = C.backgroundKind(cs.backgroundColor, cs.backgroundImage)
        if (own) return own
        for (let p = el.parentElement; p; p = p.parentElement) {
            const kind = bgKind.get(p)
            if (kind !== undefined) return kind
        }
        return null
    }

    // Read phase: pure computed-style reads → list of [property, value] writes.
    function planFor(el, cs, onImage) {
        const tag = el.tagName.toLowerCase()

        if (el.ownerSVGElement || tag === 'svg') {
            const writes = []
            if (!onImage) {
                const fill = C.newFillColor(cs.fill)
                if (fill) writes.push(['fill', fill])
                const stroke = C.newFillColor(cs.stroke)
                if (stroke) writes.push(['stroke', stroke])
            }
            return writes
        }

        const writes = []

        const bg = C.newBackgroundColor(cs.backgroundColor)
        if (bg) writes.push(['background-color', bg])

        if (C.hasDarkGradient(cs.backgroundImage)) {
            writes.push(['background-image', 'none'])
            if (!bg) writes.push(['background-color', '#fff'])
        }

        if (!onImage && !NO_TEXT_TAGS.has(tag)) {
            const color = C.newTextColor(cs.color)
            if (color) writes.push(['color', color])
            if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
                const caret = C.newTextColor(cs.caretColor)
                if (caret) writes.push(['caret-color', caret])
            }
            const border = C.newBorderColor(cs.borderColor)
            if (border) writes.push(['border-color', border])
        }

        return writes
    }

    function drain() {
        const batch = []
        for (const el of queue) {
            queue.delete(el)
            seen.add(el)
            batch.push(el)
            if (batch.length >= batchSize) break
        }

        const plans = []
        for (const el of batch) {
            const cs = styles(el)
            const kind = resolveKind(el, cs)
            bgKind.set(el, kind)
            plans.push([el, planFor(el, cs, kind === 'image')])
        }
        for (const [el, writes] of plans) {
            for (const [prop, value] of writes) {
                el.style.setProperty(prop, value, 'important')
            }
        }

        if (queue.size) schedule(drain)
        else scheduled = false
    }

    function enqueue(el) {
        if (seen.has(el) || queue.has(el) || skip(el)) return
        queue.add(el)
        if (!scheduled) {
            scheduled = true
            schedule(drain)
        }
    }

    function enqueueTree(root) {
        enqueue(root)
        if (root.querySelectorAll) {
            for (const el of root.querySelectorAll('*')) enqueue(el)
        }
    }

    function enqueueMutations(mutationList) {
        for (const mutation of mutationList) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) enqueueTree(node)
            }
        }
    }

    // :hover and :focus rules only enter computed style while active, so the
    // load-time pass never saw them — a:hover { background-color: #000 } is
    // the classic offender. Re-plan the entered element and its ancestors:
    // the browser applies hover styling before dispatching, so computed
    // styles already show the dark background and the inline !important
    // write then wins over the stylesheet rule for good.
    function applyPointerTarget(target) {
        const chain = []
        for (let el = target; el && el.nodeType === 1 && chain.length < MAX_HOVER_CHAIN; el = el.parentElement) {
            if (!skip(el)) chain.push(el)
        }
        const plans = []
        // Nearest ancestor first so kinds resolve top-down. Already-seen
        // elements are deliberately re-planned: their hover look may be new.
        for (let i = chain.length - 1; i >= 0; i--) {
            const el = chain[i]
            const cs = styles(el)
            const kind = resolveKind(el, cs)
            bgKind.set(el, kind)
            plans[i] = [el, planFor(el, cs, kind === 'image')]
        }
        for (const [el, writes] of plans) {
            for (const [prop, value] of writes) {
                el.style.setProperty(prop, value, 'important')
            }
        }
    }

    return { enqueue, enqueueTree, enqueueMutations, applyPointerTarget }
}

const EinkEngine = { createEngine, STYLE_TEXT, SKIP_TAGS, NO_TEXT_TAGS, SVG_SHAPES, MAX_HOVER_CHAIN }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EinkEngine
} else {
    globalThis.EinkEngine = EinkEngine
}

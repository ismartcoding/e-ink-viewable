// E-ink conversion engine.
//
// Owns every conversion decision that needs the DOM: which elements are
// skipped, what an element effectively sits on, which inline styles to write,
// batching, mutation handling, hover handling and re-planning after class or
// form-state changes. It knows nothing about chrome APIs or pages: computed
// styles and frame scheduling are injected, so tests can drive it on fake
// elements (tests/engine.test.js).
//
// Contract:
// - computed styles are read for a whole batch before any style is written
//   (mixing the two forces a style recalc per element and janks the page),
// - elements are processed once each, in animation-frame batches,
// - over a background image the site's own text/border/svg colors are kept —
//   only opaque dark backgrounds are rewritten,
// - the mutation path watches added nodes and class changes only (never
//   style/data-eink-p), so our own writes can never feed back into it,
// - re-plans (hover, class changes, form state) write only values that differ
//   from what the engine already wrote: an already-correct re-plan costs one
//   computed-style read and zero style invalidations,
// - a CSS transition hides its destination from computed styles — a pass that
//   runs at transition start reads the old color. Transitioning elements get
//   exactly one re-check after the transition ends; the inline write that
//   lands then locks the color, so later transitions of that property can
//   never race again.

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

// Properties whose transition can hide a final color from a re-plan.
// 'background' is the shorthand spelling some computed styles report.
const TRANSITION_PROPS = new Set([
    'all', 'color', 'background-color', 'background', 'border-color',
    'caret-color', 'fill', 'stroke', 'opacity'
])
const RECHECK_GRACE_MS = 30 // transition end + slack before re-reading
const RECHECK_MAX_MS = 2000 // never wait longer, even for long transitions

// Mode B (Contrast): black-and-white mode — black text everywhere, white
// background only where an element actually painted one. The stylesheet
// forces text color, glyph paint (-webkit-text-fill-color renders OVER
// color — white buttons on marketing sites are almost always this), caret,
// native control accents, placeholders and text shadow: the triple
// :not(#eink) raises specificity to three IDs, so the rules out-rank any
// site rule short of an ID-carrying !important. What the stylesheet cannot
// reach — a document stylesheet's selectors never match content inside open
// shadow roots — or cannot beat — an ID-carrying !important site rule — the
// pass below flips inline, where only a site inline style wins. Backgrounds
// are deliberately NOT blanket-forced: an element the site left transparent
// stays transparent, so layered/glass designs keep their look — what shows
// through is an ancestor that painted something (whitened by the pass
// below) or the white root. The pass writes `background: #fff` per element
// where the element painted a color, image or gradient; the shorthand
// clears those, so nothing dark can sit behind the forced black text;
// <img> media keeps its colors. The :hover/:focus/:focus-visible/:active
// rule is the other blanket background: interaction states are exactly when
// a site paints its own background (the classic dark a:hover), the one-shot
// pass never sees that moment, and a rest-state-transparent element must
// still go white the instant it paints — black text on a dark hover paint
// is the failure this rule prevents. The ::before/::after rule forces only
// the text: pseudo backgrounds are handled per element by the pass, because
// their paints are graphics (GitHub's selected-tab underline, badges) —
// blanketing them white erased accent indicators against the white page
// (the missing nav underline on github.com). Selection and scrollbars join
// the forced black-and-white palette — a mode that recolors everything else
// must not leave a site-styled selection or scrollbar colored.
// border-color and box-shadow are likewise not forced here: CSS cannot tell
// a transparent border (spacing, alignment — Google's search box reserves
// 8px with one) or a black shadow from a colored one, and blanket rules
// would paint solid black bars or delete every shadow. The contrast pass
// below fixes both per element — colored borders and shadows turn black,
// transparent borders and black shadows stay.
const CONTRAST_TEXT = `
html { color-scheme: light !important; scrollbar-color: #000 #fff !important; background: #fff !important; }
::-webkit-scrollbar-track { background-color: #fff !important; }
::-webkit-scrollbar-thumb { background-color: #000 !important; }
::-webkit-scrollbar-corner { background-color: #fff !important; }
::selection { background-color: #000 !important; color: #fff !important; }
*:not(#eink):not(#eink):not(#eink) {
  color: #000 !important;
  -webkit-text-fill-color: #000 !important;
  caret-color: #000 !important;
  accent-color: #000 !important;
  text-shadow: none !important;
}
*:not(#eink):not(#eink):not(#eink):hover,
*:not(#eink):not(#eink):not(#eink):focus,
*:not(#eink):not(#eink):not(#eink):focus-visible,
*:not(#eink):not(#eink):not(#eink):active {
  background: #fff !important;
}
*:not(#eink):not(#eink):not(#eink)::placeholder {
  color: #000 !important;
  -webkit-text-fill-color: #000 !important;
}
*:not(#eink):not(#eink):not(#eink)::before,
*:not(#eink):not(#eink):not(#eink)::after {
  color: #000 !important;
  -webkit-text-fill-color: #000 !important;
  text-shadow: none !important;
}`

// Mode B backgrounds, borders and shadows: read each element once and write
// only where something actually paints. A painted background — any color
// with alpha, or any image/gradient — becomes flat white; the shorthand also
// clears images and gradients, so nothing dark can sit behind the forced
// black text. A fully transparent element is left clear: it shows an
// ancestor's whitened surface or the white root, and layered designs keep
// their look. Pseudo-elements get the same per-paint read: their paints are
// graphics (selected-tab underlines, badges), so a color or gradient turns
// black like a border and stays visible on the white page — blanketing them
// white erased GitHub's accent underline — while a url() photo fill goes
// white like a surface. Pseudo-elements cannot take inline styles, so their
// writes become generated stylesheet rules on a data-eink-p hook attribute.
// Text the stylesheet lost — white glyph paints inside open shadow roots or
// behind an ID-carrying !important site rule — is flipped inline with the
// same light-paint threshold as everywhere: only what would be invisible on
// white changes, mid grays keep the site's paint. Pseudo reads are skipped
// for replaced media and form controls (pseudo-elements never render there —
// two getComputedStyle calls saved per element). Batching follows the same
// discipline as the engine (read the whole batch, then write). A border side
// counts as colored when its alpha is at least half; everything fainter
// reads as decorative transparency. Colored box-shadows are blackened in
// place (newBoxShadow keeps their alpha); black ones and 'none' stay, so
// shadows survive contrast mode instead of being dropped.
const BORDER_OPAQUE = 0.5
const BORDER_SIDES = ['Top', 'Right', 'Bottom', 'Left']
const PSEUDOS = ['::before', '::after']
// Pseudo-elements never render on these; ::placeholder exists on the first
// two only.
const FORM_TAGS = new Set(['input', 'textarea', 'select'])

function createContrastPass(C, { styles, schedule, applyCss = () => {}, batchSize = 400 }) {
    // True when the element paints anything behind its text: a background
    // color with any alpha (even a faint overlay darkens what the black text
    // sits on) or any image/gradient. Fully transparent elements show an
    // ancestor's already-whitened surface, so they stay clear.
    function paintsBackground(cs) {
        const c = C.parseColor(cs.backgroundColor)
        if (c && c.a > 0) return true
        const image = String(cs.backgroundImage || '')
        return image !== '' && image !== 'none'
    }

    const seen = new WeakSet()
    const queue = new Set()
    const written = new WeakMap() // el → Map(prop → value we wrote inline)
    const pseudoCss = new Map()   // 'id|::pseudo' → rule text already emitted
    let pseudoCounter = 0
    let scheduled = false

    // Skipped tags and non-painting svg internals — shared by scan and replan.
    function skippable(el) {
        const tag = el.tagName.toLowerCase()
        if (SKIP_TAGS.has(tag)) return true
        if (el.ownerSVGElement || tag === 'svg') {
            return tag !== 'svg' && !SVG_SHAPES.has(tag)
        }
        return false
    }

    // Writes the desired inline state and removes anything we wrote earlier
    // that no longer applies — a class change can un-paint an element, and
    // the stale inline white must go with it. Identical values are skipped:
    // re-plans run on every class churn, most change nothing.
    function applyWrites(el, writes) {
        const prev = written.get(el)
        const next = new Map(writes)
        if (prev) {
            for (const prop of prev.keys()) {
                if (!next.has(prop)) el.style.removeProperty(prop)
            }
        }
        for (const [prop, value] of next) {
            if (!prev || prev.get(prop) !== value) el.style.setProperty(prop, value, 'important')
        }
        if (next.size) written.set(el, next)
        else written.delete(el)
    }

    function drain() {
        const batch = []
        for (const el of queue) {
            queue.delete(el)
            seen.add(el)
            batch.push(el)
            if (batch.length >= batchSize) break
        }

        // read phase: a painted background or a border width gates the
        // color writes, the shadow color is its own gate
        const plans = []
        for (const el of batch) {
            const cs = styles(el)
            const tag = el.tagName.toLowerCase()
            if (el.ownerSVGElement || tag === 'svg') {
                // svg paints with fill/stroke, not CSS surfaces: a light fill
                // designed against a dark site vanishes on the whitened page,
                // so it follows the (forced black) text color like in auto mode
                const writes = []
                const fill = C.newFillColor(cs.fill)
                if (fill) writes.push(['fill', fill])
                const stroke = C.newFillColor(cs.stroke)
                if (stroke) writes.push(['stroke', stroke])
                if (writes.length) plans.push([el, writes, []])
                continue
            }
            const shadow = C.newBoxShadow(cs.boxShadow)
            let width = 0
            for (const side of BORDER_SIDES) width += parseFloat(cs['border' + side + 'Width']) || 0
            const painted = paintsBackground(cs)
            // Text the stylesheet cannot reach or cannot beat: computed white
            // after our own sheet applied means the site rule won (or the
            // element sits in a shadow root our sheet never matches) — inline
            // is the only write left. Dark and mid grays keep their paint.
            const textWrites = []
            if (!NO_TEXT_TAGS.has(tag)) {
                const color = C.newTextColor(cs.color)
                if (color) textWrites.push(['color', color])
                const fillColor = C.newTextColor(cs.webkitTextFillColor)
                if (fillColor) textWrites.push(['-webkit-text-fill-color', fillColor])
                if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
                    const caret = C.newTextColor(cs.caretColor)
                    if (caret) textWrites.push(['caret-color', caret])
                }
            }
            const pseudoPaints = []
            if (!NO_TEXT_TAGS.has(tag) && !FORM_TAGS.has(tag)) {
                for (const pseudo of PSEUDOS) {
                    const pcs = styles(el, pseudo)
                    if (!pcs || pcs.content === 'none' || !paintsBackground(pcs)) continue
                    const photo = String(pcs.backgroundImage || '').includes('url(')
                    pseudoPaints.push([pseudo, photo ? '#fff' : '#000'])
                }
            }
            const id = el.getAttribute('data-eink-p')
            const hasRules = id !== null && PSEUDOS.some(p => pseudoCss.has(id + '|' + p))
            // elements we wrote before stay in the plan even when fully clear:
            // applyWrites must be able to drop their stale inline values
            if (!painted && !width && !shadow && !textWrites.length && !pseudoPaints.length && !hasRules && !written.has(el)) continue
            const writes = [...textWrites]
            if (painted) writes.push(['background', '#fff'])
            if (width) {
                for (const side of BORDER_SIDES) {
                    const c = C.parseColor(cs['border' + side + 'Color'])
                    if (c && c.a >= BORDER_OPAQUE) writes.push(['border-' + side.toLowerCase() + '-color', '#000'])
                }
            }
            if (shadow) writes.push(['box-shadow', shadow])
            plans.push([el, writes, pseudoPaints])
        }

        // write phase: inline !important wins over any site rule; colors and
        // shadows only repaint, they never reflow. A pseudo paint lands as a
        // generated rule on the element's data-eink-p hook, deduped by text;
        // when a re-plan un-paints a pseudo, a reset rule supersedes the old
        // one (the sheet is append-only, a later rule wins).
        for (const [el, writes, pseudoPaints] of plans) {
            applyWrites(el, writes)
            let id = el.getAttribute('data-eink-p')
            const hasRules = id !== null && PSEUDOS.some(p => pseudoCss.has(id + '|' + p))
            if (!pseudoPaints.length && !hasRules) continue
            if (!id) {
                pseudoCounter += 1
                id = String(pseudoCounter)
                el.setAttribute('data-eink-p', id)
            }
            let cssText = ''
            for (const pseudo of PSEUDOS) {
                const key = id + '|' + pseudo
                const paint = pseudoPaints.find(([p]) => p === pseudo)
                const rule = paint
                    ? `[data-eink-p="${id}"]${pseudo}{background:${paint[1]}!important}`
                    : (pseudoCss.has(key) ? `[data-eink-p="${id}"]${pseudo}{background:none!important}` : null)
                if (!rule || pseudoCss.get(key) === rule) continue
                pseudoCss.set(key, rule)
                cssText += rule
            }
            if (cssText) applyCss(cssText)
        }

        if (queue.size) schedule(drain)
        else scheduled = false
    }

    function scan(el) {
        if (el.nodeType !== 1 || seen.has(el) || queue.has(el)) return
        if (skippable(el)) return
        queue.add(el)
        // The wildcard stylesheet no longer paints backgrounds, so open
        // shadow roots must be walked here — querySelectorAll and the
        // document observer both stop at the shadow boundary. (Closed ones
        // are unreachable from JS; their text still goes black via CSS.)
        if (el.shadowRoot) scanTree(el.shadowRoot)
        if (!scheduled) {
            scheduled = true
            schedule(drain)
        }
    }

    function scanTree(root) {
        scan(root)
        if (root.querySelectorAll) {
            for (const el of root.querySelectorAll('*')) scan(el)
        }
    }

    // Class churn and form commits repaint after load (theme toggles,
    // selected tabs, :checked siblings): re-read the affected elements once.
    // A one-shot scan would leak exactly the dark paints the mode exists to
    // remove — an element that was transparent at load and gains a painted
    // background via a class change. applyWrites drops stale inline values,
    // so an element that went back to clear loses its white too.
    function replan(el) {
        if (!el || el.nodeType !== 1 || skippable(el)) return
        seen.delete(el)
        if (!queue.has(el)) queue.add(el)
        if (!scheduled) {
            scheduled = true
            schedule(drain)
        }
    }

    function replanTree(root) {
        replan(root)
        if (root.querySelectorAll) {
            for (const el of root.querySelectorAll('*')) replan(el)
        }
    }

    function onMutations(mutationList) {
        for (const mutation of mutationList) {
            if (mutation.type === 'attributes') {
                replan(mutation.target)
                continue
            }
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) scanTree(node)
            }
        }
    }

    // :checked restyles siblings (input:checked + label) that the class
    // observer cannot see — mirror the auto engine's form pass.
    function applyFormChange(target) {
        if (!target || target.nodeType !== 1) return
        const parent = target.parentElement
        if (parent) replanTree(parent)
        else replan(target)
    }

    return { scanTree, onMutations, applyFormChange }
}

function createEngine(C, { styles, schedule, applyCss = () => {}, batchSize = 300, delay = () => undefined, cancelDelay = () => {} }) {
    const seen = new WeakSet()
    const queue = new Set()
    const force = new WeakSet()     // re-plan even though already processed
    const attrDirty = new WeakSet() // class changed: expand subtree when the node's own plan changes
    const bgKind = new WeakMap() // element → 'image' | 'dark' | 'light' | null
    const written = new WeakMap()   // element → Map(property → value we wrote)
    const pseudoCss = new Map()     // 'id|::pseudo' → rule text already emitted
    const recheckArmed = new WeakSet() // elements with a pending or done re-check
    const recheckEls = new Set()    // elements waiting for their re-check tick
    let recheckMs = 0
    let recheckTimer
    let scheduled = false
    let pseudoCounter = 0

    function skip(el) {
        if (el.nodeType !== 1) return true
        const tag = el.tagName.toLowerCase()
        if (SKIP_TAGS.has(tag)) return true
        if (el.ownerSVGElement && !SVG_SHAPES.has(tag)) return true
        return false
    }

    // Pseudo-elements don't paint on replaced elements, svg shapes or form
    // controls (Chrome renders none there — the reads would be pure waste).
    function pseudoCapable(el) {
        const tag = el.tagName.toLowerCase()
        if (NO_TEXT_TAGS.has(tag) || FORM_TAGS.has(tag)) return false
        if (el.ownerSVGElement || tag === 'svg') return false
        return typeof el.setAttribute === 'function'
    }

    function layerKind(cs) {
        if (cs.backgroundImage && cs.backgroundImage.includes('url(')) return 'image'
        const c = C.parseColor(cs.backgroundColor)
        if (c && c.a >= 0.5) return C.brightness(c) < 128 ? 'dark' : 'light'
        return null
    }

    // Own background first; transparent falls through to the nearest
    // processed ancestor (parents are always processed before their children:
    // document order in the load pass, explicit order in the re-plan passes).
    // The composite is decided top-down: ::after paints above ::before, which
    // paints above the element's own background — the topmost layer that has
    // something (an image or an opaque color) is what children sit on.
    function resolveKind(el, cs, beforeCs, afterCs) {
        const own = (afterCs && layerKind(afterCs)) || (beforeCs && layerKind(beforeCs)) || layerKind(cs)
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

        // background-clip:text elements paint their glyphs with a gradient —
        // that gradient is the text color, not a background. A light gradient
        // was designed against a dark surface: replace it with solid black.
        // A dark gradient stays readable on the flipped white background.
        const clip = cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text'
        if (clip) {
            if (onImage) return writes
            const avg = C.gradientAverageBrightness(cs.backgroundImage)
            if (avg === null || avg > 128) {
                writes.push(['background-image', 'none'])
                writes.push(['background-color', 'rgba(0, 0, 0, 0)'])
                writes.push(['color', '#000'])
                writes.push(['-webkit-text-fill-color', '#000'])
            }
            return writes
        }

        const bg = C.newBackgroundColor(cs.backgroundColor)
        if (bg) writes.push(['background-color', bg])

        if (C.hasDarkGradient(cs.backgroundImage)) {
            writes.push(['background-image', 'none'])
            if (!bg) writes.push(['background-color', '#fff'])
        }

        if (!onImage && !NO_TEXT_TAGS.has(tag)) {
            const color = C.newTextColor(cs.color)
            if (color) writes.push(['color', color])
            // -webkit-text-fill-color renders OVER color (gradient-text
            // patterns without the clip): a white glyph paint stays white
            // through a color flip, so it flips with the text.
            const fillColor = C.newTextColor(cs.webkitTextFillColor)
            if (fillColor) writes.push(['-webkit-text-fill-color', fillColor])
            // native checkbox/radio/progress accents: a white accent would
            // vanish on the flipped white background
            const accent = C.newTextColor(cs.accentColor)
            if (accent) writes.push(['accent-color', accent])
            if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
                const caret = C.newTextColor(cs.caretColor)
                if (caret) writes.push(['caret-color', caret])
            }
            const border = C.newBorderColor(cs.borderColor)
            if (border) writes.push(['border-color', border])
        }

        return writes
    }

    // ::placeholder exists on inputs/textareas only, styled light on dark
    // sites and left invisible after the flip; the generated-rule machinery
    // below handles it like a pseudo paint.
    function placeholderPlan(pcs) {
        const color = C.newTextColor(pcs.color)
        return color ? [['color', color]] : []
    }

    // Same decisions for ::before/::after. Pseudo-elements can't take inline
    // styles, so writes become generated stylesheet rules (see drain).
    function pseudoPlan(kind, pcs) {
        const writes = []
        const bg = C.newBackgroundColor(pcs.backgroundColor)
        if (bg) writes.push(['background-color', bg])
        if (C.hasDarkGradient(pcs.backgroundImage)) {
            writes.push(['background-image', 'none'])
            if (!bg) writes.push(['background-color', '#fff'])
        }
        if (kind !== 'image') {
            const color = C.newTextColor(pcs.color)
            if (color) writes.push(['color', color])
            const border = C.newBorderColor(pcs.borderColor)
            if (border) writes.push(['border-color', border])
        }
        return writes
    }

    // Longest transition on a color-bearing property, in milliseconds; 0
    // when the element won't animate. Computed lists are comma-separated and
    // aligned per property ('color, transform' / '0.25s, 0.3s'); a test fake
    // may omit any of them.
    function transitionEndMs(cs) {
        const props = String(cs.transitionProperty || '').split(/\s*,\s*/)
        const durations = String(cs.transitionDuration || '').split(/\s*,\s*/)
        const delays = String(cs.transitionDelay || '').split(/\s*,\s*/)
        let max = 0
        for (let i = 0; i < props.length; i++) {
            if (!TRANSITION_PROPS.has(props[i])) continue
            const duration = secondsToMs(durations[i] || durations[durations.length - 1])
            const wait = secondsToMs(delays[i] || delays[delays.length - 1])
            if (duration + wait > max) max = duration + wait
        }
        return max
    }

    function secondsToMs(token) {
        const n = parseFloat(token)
        return isNaN(n) ? 0 : n * 1000
    }

    // Write a plan, skipping values the engine already wrote to this
    // element. Every skip is a style invalidation the page doesn't pay:
    // re-plans run on every hover and class churn, and most change nothing.
    function applyWrites(el, writes) {
        let map = written.get(el)
        let changed = false
        for (const [prop, value] of writes) {
            if (map && map.get(prop) === value) continue
            el.style.setProperty(prop, value, 'important')
            if (!map) {
                map = new Map()
                written.set(el, map)
            }
            map.set(prop, value)
            // the stale-value race this element was armed against is fixed now
            recheckArmed.delete(el)
            changed = true
        }
        return changed
    }

    // One delayed re-plan tick for every element whose pass ran during a
    // transition: after the longest transition ends (+ slack) the final
    // colors are computed and the same decisions run on real values. New
    // elements join the pending tick instead of stacking timers.
    function armRecheck(candidates, maxEndMs) {
        let added = false
        for (const el of candidates) {
            if (recheckArmed.has(el)) continue
            recheckArmed.add(el)
            recheckEls.add(el)
            added = true
        }
        if (!added) return
        if (maxEndMs > recheckMs) recheckMs = maxEndMs
        if (recheckTimer !== undefined) cancelDelay(recheckTimer)
        recheckTimer = delay(() => {
            recheckTimer = undefined
            const els = [...recheckEls]
            recheckEls.clear()
            recheckMs = 0
            for (const el of els) replan(el)
        }, Math.min(recheckMs + RECHECK_GRACE_MS, RECHECK_MAX_MS))
    }

    function drain() {
        const batch = []
        for (const el of queue) {
            queue.delete(el)
            seen.add(el)
            batch.push([el, force.delete(el), attrDirty.delete(el)])
            if (batch.length >= batchSize) break
        }

        // Read phase: the element and its pseudo-elements, then kind
        // resolution, then planning — no writes until every read is done.
        // Transitions are scanned for forced elements only: they are the
        // re-plans that can run during a transition.
        const plans = []
        const pseudoPlans = []
        for (const [el, forced, wasAttrDirty] of batch) {
            const cs = styles(el)
            const canPseudo = pseudoCapable(el)
            const beforeCs = canPseudo ? styles(el, '::before') : null
            const afterCs = canPseudo ? styles(el, '::after') : null
            const tag = el.tagName.toLowerCase()
            const placeholderCs = (tag === 'input' || tag === 'textarea') ? styles(el, '::placeholder') : null
            const kind = resolveKind(el, cs, beforeCs, afterCs)
            bgKind.set(el, kind)
            plans.push({
                el, forced, wasAttrDirty,
                endMs: forced ? transitionEndMs(cs) : 0,
                writes: planFor(el, cs, kind === 'image')
            })
            if (canPseudo) {
                if (beforeCs) {
                    const writes = pseudoPlan(kind, beforeCs)
                    if (writes.length) pseudoPlans.push([el, '::before', writes])
                }
                if (afterCs) {
                    const writes = pseudoPlan(kind, afterCs)
                    if (writes.length) pseudoPlans.push([el, '::after', writes])
                }
            }
            if (placeholderCs) {
                const writes = placeholderPlan(placeholderCs)
                if (writes.length) pseudoPlans.push([el, '::placeholder', writes])
            }
        }

        // Write phase: inline styles for the element, generated rules for the
        // pseudo-elements (they cannot take inline styles). A class-changed
        // node whose own colors changed also restyled its descendants via
        // inheritance — re-plan the subtree; class churn that changed nothing
        // stops here, one read per node and no writes.
        let recheckMs = 0
        const recheckCandidates = []
        for (const p of plans) {
            const changed = applyWrites(p.el, p.writes)
            if (p.wasAttrDirty && changed) replanTree(p.el)
            if (p.forced && p.endMs > 0) {
                recheckCandidates.push(p.el)
                if (p.endMs > recheckMs) recheckMs = p.endMs
            }
        }
        if (recheckCandidates.length) armRecheck(recheckCandidates, recheckMs)

        let cssText = ''
        for (const [el, pseudo, writes] of pseudoPlans) {
            let id = el.getAttribute('data-eink-p')
            if (!id) {
                pseudoCounter += 1
                id = String(pseudoCounter)
                el.setAttribute('data-eink-p', id)
            }
            const decls = writes.map(([prop, value]) => `${prop}:${value}!important`).join(';')
            const rule = `[data-eink-p="${id}"]${pseudo}{${decls}}`
            const key = id + '|' + pseudo
            if (pseudoCss.get(key) === rule) continue // byte-identical: appending would only grow the sheet
            pseudoCss.set(key, rule)
            cssText += rule
        }
        if (cssText) applyCss(cssText)

        if (queue.size) schedule(drain)
        else scheduled = false
    }

    function kick() {
        if (!scheduled) {
            scheduled = true
            schedule(drain)
        }
    }

    function enqueue(el) {
        if (seen.has(el) || queue.has(el) || skip(el)) return
        queue.add(el)
        kick()
    }

    function enqueueTree(root) {
        enqueue(root)
        if (root.querySelectorAll) {
            for (const el of root.querySelectorAll('*')) enqueue(el)
        }
    }

    function enqueueMutations(mutationList) {
        for (const mutation of mutationList) {
            if (mutation.type === 'attributes') {
                markAttrChange(mutation.target)
                continue
            }
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) enqueueTree(node)
            }
        }
    }

    // Force re-planning: class changes, form state and transition re-checks
    // restyle nodes the load pass already converted. Top-down kind resolution
    // holds because callers enqueue ancestors before descendants and
    // querySelectorAll walks document order.
    function replan(el) {
        if (!el || el.nodeType !== 1 || skip(el)) return
        force.add(el)
        if (!queue.has(el)) queue.add(el)
        kick()
    }

    function replanTree(root) {
        replan(root)
        if (root.querySelectorAll) {
            for (const el of root.querySelectorAll('*')) replan(el)
        }
    }

    // A class flipped on an existing node — theme toggles, tab scripts,
    // framework re-renders. Only the node itself is re-planned here; its
    // subtree joins when the node's own colors changed (the theme-toggle
    // shape), so layout-class churn costs one read and no writes.
    function markAttrChange(el) {
        if (!el || el.nodeType !== 1 || skip(el)) return
        force.add(el)
        attrDirty.add(el)
        if (!queue.has(el)) queue.add(el)
        kick()
    }

    // :hover and :focus rules only enter computed style while active, so the
    // load-time pass never saw them — a:hover { background-color: #000 } is
    // the classic offender. Re-plan the entered element and its ancestors:
    // the browser applies hover styling before dispatching, so computed
    // styles already show it — unless a transition is running, in which case
    // the re-check after it lands fixes the end state (the vite.dev
    // tab-label case: gray at mouseover, white at rest).
    function applyPointerTarget(target) {
        const chain = []
        for (let el = target; el && el.nodeType === 1 && chain.length < MAX_HOVER_CHAIN; el = el.parentElement) {
            if (!skip(el)) chain.push(el)
        }
        chain.reverse() // nearest ancestor first so kinds resolve top-down
        replanList(chain)
    }

    // Checkbox/radio/select commits restyle SIBLINGS (input:checked + label)
    // and :has() ancestors — neither the class observer nor the pointer
    // passes can see that. Re-plan the control's parent subtree plus the
    // ancestor chain, through the queue so large subtrees stay batched.
    function applyFormChange(target) {
        if (!target || target.nodeType !== 1) return
        const ancestors = []
        for (let el = target.parentElement; el && el.nodeType === 1 && ancestors.length < MAX_HOVER_CHAIN; el = el.parentElement) {
            if (!skip(el)) ancestors.push(el)
        }
        for (let i = ancestors.length - 1; i >= 0; i--) replan(ancestors[i])
        if (target.parentElement) replanTree(target.parentElement)
    }

    // Re-plan a short, known list synchronously: read every computed style,
    // then write. Hover chains only — capped at MAX_HOVER_CHAIN; anything
    // tree-sized goes through the queue instead so it stays batched.
    function replanList(els) {
        const plans = []
        for (const el of els) {
            const cs = styles(el)
            const kind = resolveKind(el, cs)
            bgKind.set(el, kind)
            plans.push([el, planFor(el, cs, kind === 'image'), transitionEndMs(cs)])
        }
        let maxEnd = 0
        for (const [el, writes, endMs] of plans) {
            applyWrites(el, writes)
            if (endMs > maxEnd) maxEnd = endMs
        }
        if (maxEnd > 0) armRecheck(plans.map(([el]) => el), maxEnd)
    }

    return { enqueue, enqueueTree, enqueueMutations, applyPointerTarget, applyFormChange }
}

const EinkEngine = { createEngine, createContrastPass, STYLE_TEXT, CONTRAST_TEXT, SKIP_TAGS, NO_TEXT_TAGS, SVG_SHAPES, MAX_HOVER_CHAIN }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EinkEngine
} else {
    globalThis.EinkEngine = EinkEngine
}

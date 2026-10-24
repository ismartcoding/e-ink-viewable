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

const FORM_TAGS = new Set(['input', 'textarea', 'select'])

// HTML inline-level tags. A span used as a checkbox track stays a span even
// when CSS (or flexbox blockification) computes it to display:block/flex.
const INLINE_TAGS = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em',
    'i', 'kbd', 'label', 'mark', 'output', 'q', 'ruby', 's', 'samp',
    'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var'
])

// Empty inline-level leaves (a span used as a checkbox, a status dot) paint
// themselves with their background — the color IS the graphic. Rewriting it
// would erase the control. Text or element children mean the background is a
// surface (badge, chip), not the widget itself. Computed display alone is not
// enough: a flex parent blockifies the span to display:block.
function isLeafInlineWidget(el, cs) {
    const tag = String(el.tagName || '').toLowerCase()
    const display = String(cs.display || '')
    if (!INLINE_TAGS.has(tag) && !display.startsWith('inline')) return false
    if (typeof el.childElementCount === 'number' && el.childElementCount > 0) return false
    if (el.children && el.children.length > 0) return false
    const text = el.textContent
    return !(typeof text === 'string' && text.trim() !== '')
}

function createEngine(C, { styles, schedule, applyCss = () => {}, batchSize = 300, delay = () => undefined, cancelDelay = () => {} }) {
    const seen = new WeakSet()
    const queue = new Set()
    const force = new WeakSet()     // re-plan even though already processed
    const attrDirty = new WeakSet() // class changed: expand subtree when the node's own plan changes
    const bgKind = new WeakMap() // element → 'image' | 'dark' | 'light' | null
    const transitionStyles = new WeakMap()
    const originalStyles = new WeakMap()
    const restored = new WeakSet()
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

        const leafWidget = isLeafInlineWidget(el, cs)
        const bg = leafWidget ? null : C.newBackgroundColor(cs.backgroundColor)
        if (bg) writes.push(['background-color', bg])

        if (!leafWidget && C.hasDarkGradient(cs.backgroundImage)) {
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
            let originals = originalStyles.get(el)
            if (!originals) {
                originals = new Map()
                originalStyles.set(el, originals)
            }
            if (!originals.has(prop)) {
                originals.set(prop, [
                    el.style.getPropertyValue ? el.style.getPropertyValue(prop) : '',
                    el.style.getPropertyPriority ? el.style.getPropertyPriority(prop) : ''
                ])
            }
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
        const transition = transitionStyles.get(el)
        if (transition) {
            const [value, priority] = transition
            if (value) el.style.setProperty('transition-property', value, priority)
            else el.style.removeProperty('transition-property')
            transitionStyles.delete(el)
        }
        return changed
    }

    function restoreStyles(el) {
        const originals = originalStyles.get(el)
        if (!originals) return
        if (!transitionStyles.has(el)) {
            transitionStyles.set(el, [
                el.style.getPropertyValue ? el.style.getPropertyValue('transition-property') : '',
                el.style.getPropertyPriority ? el.style.getPropertyPriority('transition-property') : ''
            ])
            el.style.setProperty('transition-property', 'none', 'important')
        }
        for (const [prop, [value, priority]] of originals) {
            if (value) el.style.setProperty(prop, value, priority)
            else el.style.removeProperty(prop)
        }
        originalStyles.delete(el)
        recheckArmed.delete(el)
        written.delete(el)
        restored.add(el)
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
            const reset = restored.delete(p.el)
            const changed = applyWrites(p.el, p.writes) || reset
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
            for (const el of root.querySelectorAll('*')) {
                restoreStyles(el)
                replan(el)
            }
        }
    }

    // A class flipped on an existing node — theme toggles, tab scripts,
    // framework re-renders. Only the node itself is re-planned here; its
    // subtree joins when the node's own colors changed (the theme-toggle
    // shape), so layout-class churn costs one read and no writes.
    function markAttrChange(el) {
        if (!el || el.nodeType !== 1 || skip(el)) return
        force.add(el)
        restoreStyles(el)
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

    function releasePointerTarget(target) {
        const chain = []
        for (let el = target; el && el.nodeType === 1 && chain.length < MAX_HOVER_CHAIN; el = el.parentElement) {
            if (!skip(el)) chain.push(el)
        }
        for (const el of chain) restoreStyles(el)
        for (const el of chain.reverse()) replan(el)
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

    return { enqueue, enqueueTree, enqueueMutations, applyPointerTarget, releasePointerTarget, applyFormChange }
}

const EinkEngine = { createEngine, STYLE_TEXT, SKIP_TAGS, NO_TEXT_TAGS, SVG_SHAPES, MAX_HOVER_CHAIN }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EinkEngine
} else {
    globalThis.EinkEngine = EinkEngine
}

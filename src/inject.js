// E-ink Viewable content script.
//
// Runs at document_start. On a paused site it touches nothing at all — no
// style element, no observer, no DOM walk. On an enabled site it rewrites
// only the colors that were designed for a dark background (dark background
// → white, near-white text/border/svg-fill → black) and leaves every other
// color as the page chose it, so light pages are essentially untouched.
//
// Performance contract:
// - computed styles are read in one phase and written in another (mixing the
//   two forces a style recalc per element and janks the page),
// - elements are processed in animation-frame batches, at most once each,
// - the MutationObserver watches childList only — inline !important writes
//   never trigger it, so there is no observer feedback loop.

(() => {
    'use strict'

    const C = globalThis.EinkColor

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

    const BATCH_SIZE = 300

    const seen = new WeakSet()
    const queue = new Set()
    let scheduled = false

    function skip(el) {
        if (el.nodeType !== 1) return true
        const tag = el.tagName.toLowerCase()
        if (SKIP_TAGS.has(tag)) return true
        if (el.ownerSVGElement && !SVG_SHAPES.has(tag)) return true
        return false
    }

    // Read phase: pure computed-style reads → list of [property, value] writes.
    function planFor(el, cs) {
        const tag = el.tagName.toLowerCase()

        if (el.ownerSVGElement || tag === 'svg') {
            const writes = []
            const fill = C.newFillColor(cs.fill)
            if (fill) writes.push(['fill', fill])
            const stroke = C.newFillColor(cs.stroke)
            if (stroke) writes.push(['stroke', stroke])
            return writes
        }

        const writes = []

        const bg = C.newBackgroundColor(cs.backgroundColor)
        if (bg) writes.push(['background-color', bg])

        if (C.hasDarkGradient(cs.backgroundImage)) {
            writes.push(['background-image', 'none'])
            if (!bg) writes.push(['background-color', '#fff'])
        }

        if (!NO_TEXT_TAGS.has(tag)) {
            const color = C.newTextColor(cs.color)
            if (color) writes.push(['color', color])
            if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
                const caret = C.newTextColor(cs.caretColor)
                if (caret) writes.push(['caret-color', caret])
            }
        }

        const border = C.newBorderColor(cs.borderColor)
        if (border) writes.push(['border-color', border])

        return writes
    }

    function drain() {
        const batch = []
        for (const el of queue) {
            queue.delete(el)
            seen.add(el)
            batch.push(el)
            if (batch.length >= BATCH_SIZE) break
        }

        const plans = []
        for (const el of batch) {
            plans.push([el, planFor(el, getComputedStyle(el))])
        }
        for (const [el, writes] of plans) {
            for (const [prop, value] of writes) {
                el.style.setProperty(prop, value, 'important')
            }
        }

        if (queue.size) {
            requestAnimationFrame(drain)
        } else {
            scheduled = false
        }
    }

    function enqueue(el) {
        if (seen.has(el) || queue.has(el) || skip(el)) return
        queue.add(el)
        if (!scheduled) {
            scheduled = true
            requestAnimationFrame(drain)
        }
    }

    function enqueueTree(root) {
        enqueue(root)
        if (root.querySelectorAll) {
            for (const el of root.querySelectorAll('*')) enqueue(el)
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
        for (let el = target; el && el.nodeType === 1 && chain.length < 32; el = el.parentElement) {
            if (!skip(el)) chain.push(el)
        }
        const plans = []
        for (const el of chain) {
            plans.push([el, planFor(el, getComputedStyle(el))])
        }
        for (const [el, writes] of plans) {
            for (const [prop, value] of writes) {
                el.style.setProperty(prop, value, 'important')
            }
        }
    }

    // Color-only stylesheet: native widgets/scrollbars follow a light scheme,
    // selection and scrollbars stay readable on e-ink. Nothing here changes
    // layout or size.
    function addStyle() {
        const style = document.createElement('style')
        style.textContent = `
:root { color-scheme: light !important; scrollbar-color: #000 #fff !important; }
::-webkit-scrollbar-track { background-color: #fff !important; }
::-webkit-scrollbar-thumb { background-color: #000 !important; }
::-webkit-scrollbar-corner { background-color: #fff !important; }
::selection { background-color: #000 !important; color: #fff !important; }`
        document.documentElement.appendChild(style)
    }

    function start() {
        addStyle()

        const begin = () => {
            enqueueTree(document.documentElement)

            // Watch newly added nodes only. Attribute changes are deliberately
            // not observed: inline !important writes already win over later
            // class changes, and reacting to our own style writes is what
            // caused endless churn in the old version.
            new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) enqueueTree(node)
                    }
                }
            }).observe(document.documentElement, { childList: true, subtree: true })

            document.addEventListener('mouseover', event => applyPointerTarget(event.target), true)
            document.addEventListener('focusin', event => applyPointerTarget(event.target), true)
        }

        // Stylesheets block DOMContentLoaded, so all page CSS is final here
        // and computed styles can be trusted.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', begin)
        } else {
            begin()
        }
    }

    const key = 'i:' + window.location.host
    chrome.storage.local.get(['p:all', key], items => {
        // p:all pauses every site, i:<host> pauses this one; anything set means off.
        if (!items['p:all'] && !items[key]) start()
    })

    chrome.runtime.onMessage.addListener(request => {
        if (request === 'reload') window.location.reload()
    })
})()

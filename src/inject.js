// E-ink Viewable content script — chrome/page glue only.
//
// All conversion decisions live in engine.js and toggle.js (tested in
// tests/); this file picks the site's mode and wires the chosen one up.

(() => {
    'use strict'

    const service = globalThis.Toggle.createToggleService({
        storage: { local: chrome.storage.local }
    })

    // Mode A (auto): the per-node conversion engine — keeps the page's own
    // look as far as possible.
    const startAuto = () => {
        const styleEl = document.createElement('style')
        styleEl.textContent = globalThis.EinkEngine.STYLE_TEXT
        document.documentElement.appendChild(styleEl)

        const engine = globalThis.EinkEngine.createEngine(globalThis.EinkColor, {
            styles: (el, pseudo) => (pseudo ? window.getComputedStyle(el, pseudo) : window.getComputedStyle(el)),
            schedule: callback => window.requestAnimationFrame(callback),
            applyCss: css => styleEl.append(css),
            delay: (callback, ms) => window.setTimeout(callback, ms),
            cancelDelay: handle => window.clearTimeout(handle)
        })

        const begin = () => {
            engine.enqueueTree(document.documentElement)

            // Newly added nodes, plus class changes on existing ones — theme
            // toggles and tab scripts restyle nodes the load pass already
            // converted. 'class' is the only attribute watched: the engine
            // writes style/data-eink-p, so its own changes cannot feed back.
            new MutationObserver(mutations => engine.enqueueMutations(mutations))
                .observe(document.documentElement, {
                    childList: true, subtree: true,
                    attributes: true, attributeFilter: ['class']
                })

            const onPointer = event => engine.applyPointerTarget(event.target)
            document.addEventListener('mouseover', onPointer, true)
            document.addEventListener('focusin', onPointer, true)
            // Checkbox/radio/select commits restyle siblings (input:checked +
            // label) that neither the class observer nor the pointer sees.
            document.addEventListener('change', event => engine.applyFormChange(event.target), true)
        }

        // Stylesheets block DOMContentLoaded, so all page CSS is final here
        // and computed styles can be trusted.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', begin)
        } else {
            begin()
        }
    }

    // Mode B (contrast): black-and-white mode — a wildcard stylesheet forces
    // black text on every element, including inside shadow roots; the pass
    // below whitens only the backgrounds that actually paint, so elements
    // the site left transparent stay clear. Pure CSS, so it applies
    // immediately.
    const startContrast = () => {
        const styleEl = document.createElement('style')
        styleEl.textContent = globalThis.EinkEngine.CONTRAST_TEXT
        document.documentElement.appendChild(styleEl)
        // observers must stay referenced or Chrome garbage-collects them
        const keepAlive = []
        // Heavy SPAs (railway.com, twitch.tv) scrub unknown style elements
        // after hydration — put ours back the moment anything removes it.
        // Observing only <html>'s direct children keeps this quiet: it fires
        // a handful of times per page, never per frame.
        const observer = new MutationObserver(() => {
            if (!styleEl.isConnected) document.documentElement.appendChild(styleEl)
        })
        observer.observe(document.documentElement, { childList: true })
        keepAlive.push(observer)
        // Backgrounds, borders and shadows: CSS cannot read whether an
        // element or pseudo-element paints, so each is scanned once, batched
        // like the engine; nodes added later are picked up by the same
        // observer, and class churn re-plans nodes the site repaints after
        // load (theme toggles, selected tabs). 'class' is the only attribute
        // watched: the pass writes style/data-eink-p, so its own changes
        // cannot feed back. Form commits restyle siblings
        // (input:checked + label) neither observer can see.
        const pass = globalThis.EinkEngine.createContrastPass(globalThis.EinkColor, {
            styles: el => window.getComputedStyle(el),
            schedule: callback => window.requestAnimationFrame(callback),
            applyCss: css => styleEl.append(css)
        })
        const begin = () => {
            pass.scanTree(document.documentElement)
            const passObserver = new MutationObserver(mutations => pass.onMutations(mutations))
            passObserver.observe(document.documentElement, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['class']
            })
            keepAlive.push(passObserver)
            // :checked restyles siblings the class observer cannot see
            document.addEventListener('change', event => pass.applyFormChange(event.target), true)
        }
        // Stylesheets block DOMContentLoaded, so all page CSS is final here —
        // reading computed styles any earlier judges half-styled elements
        // and caches the wrong decisions for good.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', begin)
        } else {
            begin()
        }
    }

    // The master switch (issue #4): '0' keeps every mode off the page, for
    // reading on regular monitors without disabling the extension itself.
    service.getEnabled().then(enabled => {
        if (!enabled) return
        service.getSiteMode(window.location.href).then(mode => {
            if (mode === 'off') return
            if (mode === 'contrast') return startContrast()
            startAuto()
        })
    })

    chrome.runtime.onMessage.addListener(request => {
        if (request === 'reload') window.location.reload()
    })
})()

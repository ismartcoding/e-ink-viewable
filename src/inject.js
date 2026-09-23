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

    // Mode B (contrast): black-and-white mode — one wildcard stylesheet
    // forces white backgrounds with black text on every element, including
    // inside shadow roots. Pure CSS, so it applies immediately.
    const startContrast = () => {
        const styleEl = document.createElement('style')
        styleEl.textContent = globalThis.EinkEngine.CONTRAST_TEXT
        document.documentElement.appendChild(styleEl)
    }

    service.getSiteMode(window.location.href).then(mode => {
        if (mode === 'off') return
        if (mode === 'contrast') return startContrast()
        startAuto()
    })

    chrome.runtime.onMessage.addListener(request => {
        if (request === 'reload') window.location.reload()
    })
})()

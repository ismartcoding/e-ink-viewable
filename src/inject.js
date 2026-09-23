// E-ink Viewable content script — chrome/page glue only.
//
// All conversion decisions live in engine.js (tested in tests/engine.test.js);
// this file gates the engine on the pause flags, injects the stylesheet and
// wires observers and listeners.

(() => {
    'use strict'

    const key = 'i:' + window.location.host

    chrome.storage.local.get(['p:all', key], items => {
        // p:all pauses every site, i:<host> pauses this one; anything set means off.
        if (items['p:all'] || items[key]) return

        const style = document.createElement('style')
        style.textContent = globalThis.EinkEngine.STYLE_TEXT
        document.documentElement.appendChild(style)

        const engine = globalThis.EinkEngine.createEngine(globalThis.EinkColor, {
            styles: el => window.getComputedStyle(el),
            schedule: callback => window.requestAnimationFrame(callback)
        })

        const begin = () => {
            engine.enqueueTree(document.documentElement)

            // Watch newly added nodes only. Attribute changes are deliberately
            // not observed: inline !important writes already win over later
            // class changes, and reacting to our own style writes is what
            // caused endless churn in the old version.
            new MutationObserver(mutations => engine.enqueueMutations(mutations))
                .observe(document.documentElement, { childList: true, subtree: true })

            const onPointer = event => engine.applyPointerTarget(event.target)
            document.addEventListener('mouseover', onPointer, true)
            document.addEventListener('focusin', onPointer, true)
        }

        // Stylesheets block DOMContentLoaded, so all page CSS is final here
        // and computed styles can be trusted.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', begin)
        } else {
            begin()
        }
    })

    chrome.runtime.onMessage.addListener(request => {
        if (request === 'reload') window.location.reload()
    })
})()

(() => {
    'use strict'

    const start = () => {
        const begin = () => {
            const engine = globalThis.EinkContrastDom.createContrastEngine(globalThis.EinkColor, globalThis.EinkContrast, {
                styles: (el, pseudo) => (pseudo ? window.getComputedStyle(el, pseudo) : window.getComputedStyle(el)),
                schedule: callback => window.requestAnimationFrame(callback)
            })
            engine.start(document)
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin)
        else begin()
    }
    globalThis.EinkHighContrast = { start }
})()

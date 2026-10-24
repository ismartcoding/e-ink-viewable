(() => {
    'use strict'

    const service = globalThis.Toggle.createToggleService({
        storage: { local: chrome.storage.local }
    })

    // The master switch (issue #4): '0' keeps every mode off the page, for
    // reading on regular monitors without disabling the extension itself.
    service.getEnabled().then(enabled => {
        if (!enabled) return
        service.getSiteMode(window.location.href).then(mode => {
            if (mode === 'off') return
            if (mode === 'contrast') return globalThis.EinkHighContrast.start()
            globalThis.EinkComfort.start()
        })
    })

    chrome.runtime.onMessage.addListener(request => {
        if (request === 'reload') window.location.reload()
    })
})()

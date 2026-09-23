// Popup UI behavior: what each button shows in every state and what a click
// does. The DOM elements, the toggle service and the tab access are injected,
// so tests drive it on fake elements (tests/popup-ui.test.js); popup.js is
// only the chrome.* wiring.

// siteState: true = this site paused, false = style applied, null = not a
// web page. globalPaused = 'p:all' set — the extension is off everywhere.
function createPopupUi({ service, getActiveTab, sendMessage, openPage, el }) {
    let siteState
    let globalPaused = false

    function render() {
        if (globalPaused) {
            el.toggleAll.textContent = 'Resume on all sites'
            el.toggle.disabled = true
            el.toggle.textContent = siteState == null ? 'Not available on this page' : 'Apply ink style'
            return
        }
        el.toggleAll.textContent = 'Pause on all sites'
        if (siteState == null) {
            el.toggle.textContent = 'Not available on this page'
            el.toggle.disabled = true
            return
        }
        el.toggle.textContent = siteState ? 'Apply ink style' : 'Remove ink style'
        el.toggle.disabled = false
    }

    // The active tab reloads so the change is visible right away; other tabs
    // pick it up on their next load. Pages without the content script
    // (chrome://, the store, …) just fail to receive it.
    async function reloadActiveTab() {
        const tab = await getActiveTab()
        if (!tab) return
        Promise.resolve(sendMessage(tab.id, 'reload')).catch(() => {})
    }

    async function init() {
        globalPaused = await service.getGlobal()
        const tab = await getActiveTab()
        siteState = tab ? await service.getState(tab.url) : null
        render()
    }

    el.toggle.addEventListener('click', async () => {
        const tab = await getActiveTab()
        const result = tab ? await service.toggle(tab.url) : null
        if (result) {
            siteState = result.paused
            reloadActiveTab()
        }
        render()
    })

    el.toggleAll.addEventListener('click', async () => {
        globalPaused = !globalPaused
        await service.setGlobal(globalPaused)
        render()
        reloadActiveTab()
    })

    el.shortcuts.addEventListener('click', event => {
        event.preventDefault()
        openPage('chrome://extensions/shortcuts')
    })

    return { init }
}

const PopupUi = { createPopupUi }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupUi
} else {
    globalThis.PopupUi = PopupUi
}

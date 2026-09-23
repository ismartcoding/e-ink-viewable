// Popup UI behavior: which mode is selected in every state, what each click
// does, and when the settings/help panels show. The DOM elements, the mode
// service and the tab access are injected, so tests drive it on fake
// elements (tests/popup-ui.test.js); popup.js is only the chrome.* wiring.

function createPopupUi({ service, getActiveTab, sendMessage, openPage, el }) {
    let siteMode = null // 'auto' | 'contrast' | 'off'; null = not a web page
    let defaultMode = 'auto'
    let settingsOpen = false
    let helpOpen = false

    function render() {
        for (const button of el.siteModeButtons) {
            button.classList.toggle('selected', siteMode !== null && button.dataset.mode === siteMode)
            button.disabled = siteMode === null
        }
        for (const button of el.defaultModeButtons) {
            button.classList.toggle('selected', button.dataset.mode === defaultMode)
        }
        el.settingsPanel.hidden = !settingsOpen
        el.helpPanel.hidden = !helpOpen
    }

    // The active tab reloads so the change is visible right away; other tabs
    // pick it up on their next load. Pages without the content script
    // (chrome://, the store, …) just fail to receive it.
    async function reloadActiveTab() {
        const tab = await getActiveTab()
        if (!tab) return
        Promise.resolve(sendMessage(tab.id, 'reload')).catch(() => {})
    }

    for (const button of el.siteModeButtons) {
        button.addEventListener('click', async () => {
            const tab = await getActiveTab()
            const mode = await service.setSiteMode(tab && tab.url, button.dataset.mode)
            if (!mode) return
            siteMode = mode
            render()
            reloadActiveTab()
        })
    }

    for (const button of el.defaultModeButtons) {
        button.addEventListener('click', async () => {
            const mode = await service.setDefaultMode(button.dataset.mode)
            if (!mode) return
            defaultMode = mode
            render()
            // Sites without their own override follow the default, so the
            // current tab always re-applies here.
            reloadActiveTab()
        })
    }

    el.settings.addEventListener('click', () => {
        settingsOpen = !settingsOpen
        settingsOpen && (helpOpen = false) // one panel at a time
        render()
    })

    el.help.addEventListener('click', () => {
        helpOpen = !helpOpen
        helpOpen && (settingsOpen = false)
        render()
    })

    el.shortcuts.addEventListener('click', event => {
        event.preventDefault()
        openPage('chrome://extensions/shortcuts')
    })

    async function init() {
        const tab = await getActiveTab()
        siteMode = tab ? await service.getSiteMode(tab.url) : null
        defaultMode = await service.getDefaultMode()
        render()
    }

    return { init }
}

const PopupUi = { createPopupUi }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupUi
} else {
    globalThis.PopupUi = PopupUi
}

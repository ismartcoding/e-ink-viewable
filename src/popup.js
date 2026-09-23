const service = Toggle.createToggleService({
    storage: { local: chrome.storage.local }
})

const ui = PopupUi.createPopupUi({
    service,
    getActiveTab: async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        return (tabs && tabs[0]) || null
    },
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    openPage: url => chrome.tabs.create({ url }),
    el: {
        siteModeButtons: [...document.querySelectorAll('#site-modes button')],
        defaultModeButtons: [...document.querySelectorAll('#default-modes button')],
        settings: document.getElementById('settings'),
        settingsPanel: document.getElementById('settings-panel'),
        help: document.getElementById('help'),
        helpPanel: document.getElementById('help-panel'),
        shortcuts: document.getElementById('shortcuts')
    }
})

ui.init()

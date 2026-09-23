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
        toggle: document.getElementById('toggle'),
        toggleAll: document.getElementById('toggleAll'),
        shortcuts: document.getElementById('shortcuts')
    }
})

ui.init()

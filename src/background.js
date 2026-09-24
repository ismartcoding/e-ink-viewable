// Background service worker — chrome glue only.
//
// The mode decisions live in toggle.js (tested in tests/toggle.test.js).
// The keyboard shortcut flips the current tab between off and its last mode.

importScripts('toggle.js')

const service = Toggle.createToggleService({
    storage: { local: chrome.storage.local }
})

async function toggleActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs && tabs[0]
    if (!tab) return
    const mode = await service.toggleShortcut(tab.url)
    if (mode) {
        chrome.tabs.sendMessage(tab.id, 'reload').catch(() => {}) // pages without the content script
    }
}

chrome.commands.onCommand.addListener(command => {
    if (command === 'toggle-ink-style') toggleActiveTab()
})

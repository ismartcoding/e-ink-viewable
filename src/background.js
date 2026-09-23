// Background service worker — chrome glue only.
//
// The toggle decisions live in toggle.js (tested in tests/toggle.test.js).
// The keyboard shortcut goes through the same service as the popup button.

importScripts('toggle.js')

const service = Toggle.createToggleService({
    storage: { local: chrome.storage.local, sync: chrome.storage.sync }
})

async function toggleActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs && tabs[0]
    if (!tab) return
    const result = await service.toggle(tab.url)
    if (result) {
        chrome.tabs.sendMessage(tab.id, 'reload').catch(() => {}) // pages without the content script
    }
}

chrome.commands.onCommand.addListener(command => {
    if (command === 'toggle-ink-style') toggleActiveTab()
})

chrome.runtime.onInstalled.addListener(() => service.migrateSync())
chrome.runtime.onStartup.addListener(() => service.migrateSync())
service.migrateSync()

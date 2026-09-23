// Background service worker: owns the per-site toggle (the keyboard shortcut
// and the popup button both go through here). State lives in
// chrome.storage.local so content scripts can read it fast at document_start;
// settings from the old chrome.storage.sync backend are migrated once.

const KEY_PREFIX = 'i:'

chrome.commands.onCommand.addListener(command => {
    if (command === 'toggle-ink-style') toggleActiveTab()
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request === 'getState') {
        withWebPage(tab => {
            if (!tab) {
                sendResponse(null)
                return
            }
            const key = hostKey(tab.url)
            chrome.storage.local.get(key, items => sendResponse(!!items[key]))
        })
        return true
    }
    if (request === 'toggle') {
        toggleActiveTab(sendResponse)
        return true
    }
})

chrome.runtime.onInstalled.addListener(migrateSyncSettings)
chrome.runtime.onStartup.addListener(migrateSyncSettings)
migrateSyncSettings()

function hostKey(url) {
    return KEY_PREFIX + new URL(url).host
}

function withWebPage(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs && tabs[0]
        if (!tab || !/^https?:/i.test(tab.url || '')) {
            callback(null)
            return
        }
        callback(tab)
    })
}

function toggleActiveTab(callback) {
    withWebPage(tab => {
        if (!tab) {
            if (callback) callback(null)
            return
        }
        const key = hostKey(tab.url)
        chrome.storage.local.get(key, items => {
            const paused = !!items[key]
            chrome.storage.local.set({ [key]: paused ? 0 : 1 })
            chrome.tabs
                .sendMessage(tab.id, 'reload')
                .catch(() => {}) // pages without the content script
            if (callback) callback(!paused)
        })
    })
}

function migrateSyncSettings() {
    chrome.storage.sync.get(null, items => {
        const old = {}
        for (const key of Object.keys(items)) {
            if (key.startsWith(KEY_PREFIX)) old[key] = items[key]
        }
        if (Object.keys(old).length) chrome.storage.local.set(old)
    })
}

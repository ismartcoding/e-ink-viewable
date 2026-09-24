// Background service worker — chrome glue only.
//
// The mode decisions live in toggle.js (tested in tests/toggle.test.js).
// One keyboard shortcut flips the current tab between off and its last
// mode; a second one flips the extension's master switch on every site.
//
// toggle.js is a static ES-module import (the worker is registered with
// "type": "module"): the dependency loads and is verified when the worker
// registers, not at some later point — importScripts failed at runtime
// with a bare NetworkError whenever an installed package lacked the file.
// toggle.js keeps its dual-environment tail, so the import surfaces as
// globalThis.Toggle (popup.html loads it as a classic script).
import './toggle.js'

const service = globalThis.Toggle.createToggleService({
    storage: { local: chrome.storage.local }
})

async function withActiveTab(run) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs && tabs[0]
    if (!tab) return
    const changed = await run(tab)
    if (changed) {
        chrome.tabs.sendMessage(tab.id, 'reload').catch(() => {}) // pages without the content script
    }
}

async function toggleActiveTab() {
    await withActiveTab(async tab => {
        const mode = await service.toggleShortcut(tab.url)
        return Boolean(mode)
    })
}

async function toggleEnabled() {
    const enabled = await service.getEnabled()
    await service.setEnabled(!enabled)
    await withActiveTab(async () => true) // every tab re-evaluates on its next load
}

chrome.commands.onCommand.addListener(command => {
    if (command === 'toggle-ink-style') toggleActiveTab()
    if (command === 'toggle-enabled') toggleEnabled()
})

const GLOBAL_KEY = 'p:all'

const toggleBtn = document.getElementById('toggle')
const toggleAllBtn = document.getElementById('toggleAll')

let siteState // true: this site paused, false: style applied, null: not a web page
let globalPaused = false

function render() {
    if (globalPaused) {
        toggleAllBtn.textContent = 'Resume on all sites'
        toggleBtn.disabled = true
        toggleBtn.textContent = siteState == null ? 'Not available on this page' : 'Apply ink style'
        return
    }
    toggleAllBtn.textContent = 'Pause on all sites'
    if (siteState == null) {
        toggleBtn.textContent = 'Not available on this page'
        toggleBtn.disabled = true
        return
    }
    toggleBtn.textContent = siteState ? 'Apply ink style' : 'Remove ink style'
    toggleBtn.disabled = false
}

toggleBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage('toggle', paused => {
        siteState = paused
        render()
    })
})

// Reload the active tab so the change is visible right away; other tabs pick
// it up on their next load.
function reloadActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs && tabs[0]
        if (!tab) return
        chrome.tabs.sendMessage(tab.id, 'reload').catch(() => {})
    })
}

toggleAllBtn.addEventListener('click', () => {
    globalPaused = !globalPaused
    chrome.storage.local.set({ [GLOBAL_KEY]: globalPaused ? 1 : 0 })
    render()
    reloadActiveTab()
})

document.getElementById('shortcuts').addEventListener('click', event => {
    event.preventDefault()
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
})

chrome.storage.local.get(GLOBAL_KEY, items => {
    globalPaused = !!items[GLOBAL_KEY]
    render()
})

chrome.runtime.sendMessage('getState', state => {
    siteState = state
    render()
})

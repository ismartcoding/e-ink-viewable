const toggleBtn = document.getElementById('toggle')

function render(paused) {
    if (paused === null || paused === undefined) {
        toggleBtn.textContent = 'Not available on this page'
        toggleBtn.disabled = true
        return
    }
    toggleBtn.textContent = paused ? 'Apply ink style' : 'Remove ink style'
    toggleBtn.disabled = false
}

toggleBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage('toggle', render)
})

document.getElementById('shortcuts').addEventListener('click', event => {
    event.preventDefault()
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
})

chrome.runtime.sendMessage('getState', render)

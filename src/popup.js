
function updateUI(paused) {
    $('#toggle').text(paused ? 'Apply ink style' : 'Remove ink style')
}
chrome.tabs.query(
    {
        active: true,
        currentWindow: true
    },
    function (tabs) {
        const tab = tabs[0]
        const host = new URL(tab.url).host
        const key = `i:${host}`
        chrome.storage.sync.get([key], function (items) {
            let paused = items[key]
            updateUI(paused)

            $('#toggle').on('click', function () {
                const obj = {}
                if (paused) {
                    obj[key] = 0
                } else {
                    obj[key] = 1
                }
                chrome.storage.sync.set(obj)
                paused = !paused
                updateUI(paused)

                chrome.tabs.sendMessage(
                    tab.id, 'reload'
                )
            })
        })
    })
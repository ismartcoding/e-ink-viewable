
function parseRgbString(rgb) {
    return rgb.replace(/[^\d,]/g, '').split(',')
}

function getLuma(color) {
    const c = parseRgbString(color)
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

const tagNames = ['body', 'div', 'a', 'button', 'span', 'header', 'footer', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5']

function updateStyle(node) {
    const style = window.getComputedStyle(node)

    const backgroundColor = style.backgroundColor
    if (backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'rgb(255, 255, 255)') {
        const isOverlay = ['fixed', 'absolute'].includes(style.position) && style.left === '0px' && style.top === '0px' && style.right === '0px' && style.bottom === '0px'
        if (node.textContent.trim() && !isOverlay) { // has text content
            node.style.setProperty('background-color', '#fff', 'important')
        }
    }

    node.style.setProperty('color', '#000', 'important')

    const borderColor = style.borderColor
    if (borderColor) {
        const b = getLuma(borderColor)
        if (b > 125) { // too light
            node.style.setProperty('border-color', '#000', 'important')
        }
    }
}

chrome.storage.sync.get([`i:${window.location.host}`], function (items) {
    let paused = items[`i:${window.location.host}`]
    if (!paused) {
        document.querySelectorAll('*').forEach((node) => {
            if (!tagNames.includes(node.tagName.toLowerCase())) {
                return
            }
            updateStyle(node)
        })

        const observer = new MutationObserver((mutationList) => {
            for (const mutation of mutationList) {
                mutation.target && updateStyle(mutation.target)
            }
        })

        observer.observe(document.getElementsByTagName('body')[0], { attributes: true, childList: true, subtree: true })
    }
})

chrome.runtime.onMessage.addListener(function (request) {
    if (request === 'reload') {
        window.location.reload()
    }
    return true
})
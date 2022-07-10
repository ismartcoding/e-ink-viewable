
function parseRgbString(rgb) {
    return rgb.replace(/[^\d,]/g, '').split(',')
}

//http://www.w3.org/TR/AERT#color-contrast
function getBrightness(color) {
    const c = parseRgbString(color)
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000
}

function isDark(color) {
    return getBrightness(color) < 128
}

const ignoreTagNames = ['html', 'head', 'script', 'style', 'link', 'meta', 'title', 'img', 'video', 'audio']

function ignoreTag(node) {
    if (!node.tagName) {
        return true
    }

    const tag = node.tagName.toLowerCase()

    if (ignoreTagNames.includes(tag)) {
        return true
    }

    // ignore custom tags which contain video, audio, img...
    if (['video', 'audio', 'img'].some(it => tag.includes(it))) {
        return true
    }

    if (tag === 'input' && ['checkbox', 'radio'].includes(node.type)) {
        return true
    }

    return false
}

function updateStyle(node) {
    if (ignoreTag(node)) {
        return
    }

    const style = window.getComputedStyle(node)
    const tag = node.tagName.toLowerCase()

    const backgroundColor = style.backgroundColor
    if (backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'rgb(255, 255, 255)' && backgroundColor !== 'rgba(0, 0, 0, 0)') {
        if (node.textContent.trim() || tag === 'input' || isDark(backgroundColor)) { // has text content
            node.style.setProperty('background-color', '#fff', 'important')
            // add border for code block
            if (tag === 'pre' && node.className.trim() !== 'CodeMirror-line') {
                node.style.setProperty('border', '1px solid #000', 'important')
            }
        }
    }

    if (style.background.indexOf('linear-gradient') !== -1) {   // remove linear gradient
        node.style.setProperty('background', '#fff', 'important')
    }

    node.style.setProperty('color', '#000', 'important')

    const borderColor = style.borderColor
    if (borderColor && borderColor !== 'rgb(0, 0, 0)') {
        if (!isDark(borderColor)) { // too light
            node.style.setProperty('border-color', '#000', 'important')
        }
    }

    if (tag === 'svg') {
        node.style.setProperty('fill', 'currentColor', 'important')
    }
}

chrome.storage.sync.get([`i:${window.location.host}`], function (items) {
    let paused = items[`i:${window.location.host}`]
    if (!paused) {
        document.querySelectorAll('*').forEach((node) => {
            updateStyle(node)
        })

        const observer = new MutationObserver((mutationList) => {
            for (const mutation of mutationList) {
                if (mutation.target) {
                    updateStyle(mutation.target)
                    mutation.target.childNodes.forEach((node) => {
                        updateStyle(node)
                    })
                }
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

function parseRgbString(rgb) {
    rgb = rgb.replace(/[^\d,]/g, '').split(',')
    return rgb
}

function getLuma(color) {
    const c = parseRgbString(color)
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

const tagNames = ['body', 'div', 'a', 'button', 'span']

function updateStyle(node) {
    const style = window.getComputedStyle(node)
    // overlay
    const isOverlay = ['fixed', 'absolute'].includes(style.position) && style.left === '0px' && style.top === '0px' && style.right === '0px' && style.bottom === '0px'
    const borderColor = style.borderColor
    if (node.textContent.trim() && !isOverlay) { // has text content
        node.style.setProperty('background-color', '#fff', 'important')
    } else {
        // could be just an overlay
        node.style.setProperty('background-color', 'transparent', 'important')
    }

    node.style.setProperty('color', '#000', 'important')
    if (borderColor) {
        const b = getLuma(borderColor)
        if (b > 125) { // too light
            node.style.setProperty('border-color', '#000', 'important')
        }
    }
}

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


function parseRgbString(rgb) {
    rgb = rgb.replace(/[^\d,]/g, '').split(',')
    return rgb
}

function getLuma(color) {
    const c = parseRgbString(color)
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

document.querySelectorAll('*').forEach((node) => {
    const style = window.getComputedStyle(node)
    const borderColor = style.borderColor
    if (node.textContent.trim()) { // has text content
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
})
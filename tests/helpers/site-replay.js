(() => {
const C = typeof module !== 'undefined' && module.exports ? require('../../src/color') : globalThis.EinkColor
const Policy = typeof module !== 'undefined' && module.exports ? require('../../src/high-contrast/contrast') : globalThis.EinkContrast

function loadSites() {
    const fs = require('node:fs'), path = require('node:path')
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/contrast-sites.json'), 'utf8'))
    const style = index => ({ ...fixture.defaults, ...fixture.styles[index] })
    return fixture.sites.map(site => {
        const nodes = new Map(site.records.map(r => [r.id, {}]))
        return { ...site, records: site.records.map(r => ({ ...r, node: nodes.get(r.id), parent: nodes.get(r.parent) || null,
            svgRoot: nodes.get(r.svgRoot) || null, style: style(r.style),
            pseudos: Object.fromEntries(Object.entries(r.pseudos || {}).map(([key, value]) => [key, style(value)])) })) }
    })
}
function parse(value) {
    return C.parseColor(value) || ({ '#000': { r: 0, g: 0, b: 0, a: 1 }, '#fff': { r: 255, g: 255, b: 255, a: 1 }, transparent: { r: 0, g: 0, b: 0, a: 0 } })[value]
}
function luminance(color) {
    return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
        const value = color[['r', 'g', 'b'][i]] / 255
        return sum + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    }, 0)
}
function directTextRecords(records) {
    const parents = new Set(records.map(record => record.parent))
    return records.filter(record => record.hasText && !record.svg && !parents.has(record.node)
        && !['html', 'body', 'img', 'video', 'canvas', 'iframe', 'input', 'object', 'embed'].includes(record.tag)
        && typeof record.shape === 'string' && record.shape.slice(record.shape.indexOf(':')) === ':')
}
function sourceExpectations(site) {
    const byNode = new Map(site.records.map(r => [r.node, r])), children = new Map(), roots = new Set(), protectedNodes = new Set()
    const media = new Set(['img', 'video', 'canvas', 'iframe', 'object', 'embed', 'picture'])
    const image = style => /url\(/i.test(style['background-image'] || '')
    const positioned = r => ['absolute', 'fixed'].includes(r.style.position)
    const visible = r => !r || r.style.display !== 'none' && r.style.visibility !== 'hidden' && !(parseFloat(r.style.opacity) <= 0) && visible(byNode.get(r.parent))
    const overlaps = (a, b) => a.rect.width > 0 && a.rect.height > 0 && b.rect.width > 0 && b.rect.height > 0
        && a.rect.left < b.rect.left + b.rect.width && a.rect.left + a.rect.width > b.rect.left
        && a.rect.top < b.rect.top + b.rect.height && a.rect.top + a.rect.height > b.rect.top
    for (const r of site.records) {
        if (!children.has(r.parent)) children.set(r.parent, [])
        children.get(r.parent).push(r)
        if (r.unsafe || image(r.style) || Object.values(r.pseudos || {}).some(p => image(p) && p.content !== 'none' && p.content !== 'normal'
            && (parseFloat(p.width) > 64 || parseFloat(p.height) > 64))) roots.add(r.node)
    }
    const svg = new Map()
    for (const r of site.records) {
        if (r.svgRoot) {
            if (!svg.has(r.svgRoot)) svg.set(r.svgRoot, new Set())
            for (const key of ['fill', 'stroke']) {
                const color = parse(r.style[key])
                if (color?.a > 0) svg.get(r.svgRoot).add(JSON.stringify(color))
            }
        }
        const parent = byNode.get(r.parent), backgroundMedia = image(r.style) && positioned(r)
        if (!parent || ['html', 'body'].includes(parent.tag) || !media.has(r.tag) && !backgroundMedia) continue
        const viewport = site.viewport || { width: 1024, height: 768 }
        if (r.style.position === 'fixed' && r.rect.width >= viewport.width && r.rect.height >= viewport.height) continue
        const coversParent = parent.rect.width > 0 && parent.rect.height > 0
            && r.rect.left <= parent.rect.left && r.rect.top <= parent.rect.top
            && r.rect.left + r.rect.width >= parent.rect.left + parent.rect.width
            && r.rect.top + r.rect.height >= parent.rect.top + parent.rect.height
        const foregrounds = (children.get(parent.node) || []).filter(other => other.node !== r.node && other.hasText && visible(other)
            && (positioned(other) || backgroundMedia && coversParent) && overlaps(r, other))
        if (coversParent && foregrounds.length) roots.add(parent.node)
        else for (const foreground of foregrounds) roots.add(foreground.node)
    }
    for (const [node, colors] of svg) if (colors.size > 2) roots.add(node)
    const pending = [...roots]
    while (pending.length) {
        const node = pending.pop()
        if (protectedNodes.has(node)) continue
        protectedNodes.add(node)
        for (const child of children.get(node) || []) pending.push(child.node)
    }
    const interactive = r => r.selected || r.focusable || r.interacted || ['a', 'button', 'summary', 'option'].includes(r.tag)
        || ['button', 'tab', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'radio', 'checkbox', 'switch', 'treeitem'].includes(r.role)
    const ordinaryText = new Set()
    for (const r of directTextRecords(site.records)) {
        let current = r
        while (current && !interactive(current) && !protectedNodes.has(current.node)) current = byNode.get(current.parent)
        if (!current) ordinaryText.add(r.node)
    }
    return { protectedNodes, ordinaryText, children, byNode }
}
function measure(site, plans, readStyle) {
    const expected = sourceExpectations(site), { byNode } = expected
    const directText = new Set(directTextRecords(site.records).map(record => record.node))
    const styles = new Map(), backgrounds = new Map(), issues = []
    const style = (r, pseudo = '') => {
        if (!styles.has(r.node)) styles.set(r.node, new Map())
        const cached = styles.get(r.node)
        if (!cached.has(pseudo)) cached.set(pseudo, readStyle ? readStyle(r, pseudo)
            : { ...(pseudo ? r.pseudos?.[pseudo] : r.style), ...plans.get(r.node)?.rules[pseudo] })
        return cached.get(pseudo)
    }
    const background = r => {
        if (!r) return parse('#fff')
        if (!backgrounds.has(r.node)) backgrounds.set(r.node, Policy.over(parse(style(r)['background-color']) || parse('transparent'), background(byNode.get(r.parent))))
        return backgrounds.get(r.node)
    }
    const visible = r => !r || style(r).display !== 'none' && style(r).visibility !== 'hidden'
        && !(parseFloat(style(r).opacity) <= 0) && visible(byNode.get(r.parent))
    const colorKey = value => {
        const color = parse(value)
        return color ? [color.r, color.g, color.b, color.a].join(',') : value || ''
    }
    const normalize = value => (value || '').replace(/#[0-9a-f]+|rgba?\([^)]*\)|oklch\([^)]*\)/gi, colorKey)
        .replace(/\b0px\b/g, '0').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim()
    const boundaries = s => [
        ...['top', 'right', 'bottom', 'left'].map(side => parseFloat(s[`border-${side}-width`]) > 0 && s[`border-${side}-style`] !== 'none'
            ? [s[`border-${side}-width`], s[`border-${side}-style`], colorKey(s[`border-${side}-color`])] : []),
        parseFloat(s['outline-width']) > 0 && s['outline-style'] !== 'none'
            ? [s['outline-width'], s['outline-style'], colorKey(s['outline-color'])] : [],
        s['box-shadow'] !== 'none' ? normalize(s['box-shadow']) : '',
        s['text-decoration-line'] !== 'none' ? [s['text-decoration-line'] || '', colorKey(s['text-decoration-color'])] : []
    ]
    const cue = r => {
        const s = style(r), pseudos = []
        for (const name of Object.keys(r.pseudos || {})) {
            const p = style(r, name)
            if (parse(p['background-color'])?.a > 0) pseudos.push([name, colorKey(p['background-color']), p.width, p.height, p.opacity, boundaries(p)])
        }
        return JSON.stringify([background(r), colorKey(s['-webkit-text-fill-color'] || s.color), boundaries(s), pseudos])
    }
    const text = [], selected = [], converted = [], protectedNodes = [], eligibleText = [], protectedText = []
    for (const record of site.records) {
        const plan = plans.get(record.node)
        const readableText = directText.has(record.node) && visible(record) && record.rect.width > 0 && record.rect.height > 0
            && record.style['background-clip'] !== 'text' && record.style['-webkit-background-clip'] !== 'text'
            && !record.style['background-image']?.includes('gradient')
        if (readableText) {
            eligibleText.push(record.id)
            if (plan.protected) protectedText.push(record.id)
        }
        if (plan.protected) {
            protectedNodes.push(record.id)
            if (!expected.protectedNodes.has(record.node)) issues.push(`Ordinary node ${record.id} was protected`)
            continue
        }
        if (plan.rules['']) converted.push(record.id)
        if (record.selected && !record.disabled && visible(record)) {
            selected.push(record.id)
            const peers = (expected.children.get(record.parent) || []).filter(peer => peer.node !== record.node && !peer.selected && !peer.disabled && visible(peer)
                && (record.role ? peer.role === record.role : peer.tag === record.tag && peer.shape === record.shape))
            if (peers.some(peer => cue(peer) === cue(record))) issues.push(`Selected node ${record.id} has no distinct cue from an unselected peer`)
        }
        if (!readableText) continue
        const s = style(record), fg = parse(s['-webkit-text-fill-color'] || s.color)
        if (!fg || fg.a === 0) continue
        const bg = background(record), glyph = Policy.over(fg, bg)
        const l1 = luminance(glyph), l2 = luminance(bg)
        text.push({ id: record.id, tag: record.tag, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) })
        const channel = (color, value) => color.a >= 0.999 && ['r', 'g', 'b'].every(key => Math.abs(color[key] - value) < 0.001)
        if (expected.ordinaryText.has(record.node) && (!channel(bg, 255) || !channel(glyph, 0)))
            issues.push(`Ordinary text ${record.id} must have a white surface and black glyphs`)
    }
    if (!text.length) issues.push('No converted visible direct text checked')
    for (const entry of text) if (entry.ratio < 7) issues.push(`${entry.tag} ${entry.id}: contrast ${entry.ratio}`)
    return { text, selected, converted, protectedNodes, eligibleText, protectedText, issues }
}
const api = { loadSites, measure, directTextRecords, sourceExpectations }
if (typeof module !== 'undefined' && module.exports) module.exports = api
else globalThis.EinkSiteReplay = api
})()

(() => {
    'use strict'

    const SIDES = ['top', 'right', 'bottom', 'left']
    const PAINT = [
        'color', '-webkit-text-fill-color', 'caret-color', 'accent-color',
        'background-color', 'background-image', 'background-clip', '-webkit-background-clip',
        'fill', 'stroke', 'mask-image', '-webkit-mask-image',
        'outline-color', 'outline-style', 'outline-width', 'outline-offset',
        'box-shadow', 'text-shadow', 'text-decoration-color', 'text-decoration-line', 'filter', 'mix-blend-mode',
        ...SIDES.flatMap(side => [`border-${side}-color`, `border-${side}-width`, `border-${side}-style`])
    ]
    const SOURCE = [...PAINT, 'display', 'position', 'opacity', 'visibility', 'content',
        'backdrop-filter', 'isolation', 'cursor',
        'width', 'height', 'font-size', 'animation-name']
    const MEDIA = new Set(['img', 'video', 'canvas', 'iframe', 'object', 'embed', 'picture'])
    const ACTIONS = new Set(['button', 'a', 'summary', 'option'])
    const ROLES = new Set(['button', 'tab', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'radio', 'checkbox', 'switch', 'treeitem', 'row'])
    const FORMS = new Set(['input', 'textarea', 'select'])
    const CLEAR = { r: 0, g: 0, b: 0, a: 0 }
    const WHITE = { r: 255, g: 255, b: 255, a: 1 }
    const MAX_FILL_HEIGHT = 96
    const MAX_FILL_AREA = 0.08
    const MAX_GROUP_FILL = 0.75
    const COLOR_DISTANCE = 0.035
    const MIN_BORDER_ALPHA = 0.5
    const BASE_RULES = {
        ':root': { 'color-scheme': 'light', 'scrollbar-color': '#000 #fff' },
        '::selection': { 'background-color': '#000', color: '#fff' },
        '::-webkit-scrollbar-track': { 'background-color': '#fff' },
        '::-webkit-scrollbar-thumb': { 'background-color': '#000' },
        '::-webkit-scrollbar-corner': { 'background-color': '#fff' }
    }

    const isAction = r => ACTIONS.has(r.tag) || ROLES.has(r.role) || r.focusable || r.interacted
    function groupCompatible(candidates) {
        if (candidates.length < 2) return false
        let minHeight = Infinity, maxHeight = 0, minLeft = Infinity, maxLeft = -Infinity, minTop = Infinity, maxTop = -Infinity
        let allActions = true, repeated = true
        for (const r of candidates) {
            minHeight = Math.min(minHeight, r.rect.height); maxHeight = Math.max(maxHeight, r.rect.height)
            minLeft = Math.min(minLeft, r.rect.left); maxLeft = Math.max(maxLeft, r.rect.left)
            minTop = Math.min(minTop, r.rect.top); maxTop = Math.max(maxTop, r.rect.top)
            allActions &&= !!isAction(r)
            repeated &&= !!r.shape && r.shape === candidates[0].shape && r.hasText && r.rect.height > 0 && r.rect.height <= MAX_FILL_HEIGHT
        }
        return maxHeight - minHeight <= Math.max(8, maxHeight / 4)
            && (maxLeft - minLeft <= 8 || maxTop - minTop <= 8) && (allActions || repeated)
    }

    function paintProperty(prop) {
        if (/^border-(top|right|bottom|left)-(width|style)$/.test(prop)) return false
        return PAINT.includes(prop) || /(?:^|-)color$/.test(prop)
            || ['background', 'border', 'outline', 'text-decoration', 'text-emphasis', '-webkit-text-stroke'].includes(prop)
    }

    function transitionPlan(style, properties) {
        const names = (style.property || 'all').split(/\s*,\s*/)
        const lists = [style.duration || '0s', style.delay || '0s', style.timing || 'ease', style.behavior || 'normal'].map(s => s.split(/\s*,\s*/))
        if (!lists[0].some(s => parseFloat(s) > 0) && !lists[1].some(s => parseFloat(s) > 0)) return null
        const result = new Map()
        let removed = false
        for (let i = 0; i < names.length; i++) {
            const name = names[i]
            const targets = name === 'all' ? properties : [name]
            if (name === 'all' || paintProperty(name)) removed = true
            for (const prop of targets) {
                if (prop === 'none' || paintProperty(prop)) continue
                result.delete(prop)
                result.set(prop, lists.map(list => list[i % list.length]))
            }
        }
        if (!removed) return null
        if (!result.size) return { 'transition-property': 'none' }
        const values = [...result.values()]
        return {
            'transition-property': [...result.keys()].join(','),
            'transition-duration': values.map(v => v[0]).join(','),
            'transition-delay': values.map(v => v[1]).join(','),
            'transition-timing-function': values.map(v => v[2]).join(','),
            'transition-behavior': values.map(v => v[3]).join(',')
        }
    }

    function createTransitionCache(properties, build = transitionPlan) {
        const cache = new Map()
        return (style, custom = []) => {
            const key = JSON.stringify([style, custom])
            if (!cache.has(key)) cache.set(key, build(style, custom.length ? [...new Set([...properties, ...custom])] : properties))
            return cache.get(key)
        }
    }

    function over(fg, bg) {
        const a = fg.a + bg.a * (1 - fg.a)
        if (!a) return CLEAR
        const channel = key => (fg[key] * fg.a + bg[key] * bg.a * (1 - fg.a)) / a
        return { r: channel('r'), g: channel('g'), b: channel('b'), a }
    }

    function lab(c) {
        const linear = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        const r = linear(c.r), g = linear(c.g), b = linear(c.b)
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
    }

    function distance(a, b) {
        if (a.r === b.r && a.g === b.g && a.b === b.b) return 0
        const x = lab(a), y = lab(b)
        return Math.hypot(...x.map((v, i) => v - y[i]))
    }

    function colorKey(c) {
        return [c.r, c.g, c.b, c.a].map(n => Math.round(n * 1000) / 1000).join(',')
    }

    function createPlanner(C) {
        let groups = new WeakMap()
        let resting = new WeakMap()
        const colors = new Map()
        const parse = s => {
            if (!colors.has(s)) {
                if (colors.size >= 4096) colors.clear()
                colors.set(s, C.parseColor(s) || (s === '#000' ? { ...CLEAR, a: 1 } : s === '#fff' ? WHITE : CLEAR))
            }
            return colors.get(s)
        }
        const opaque = r => parse(r.style['background-color']).a >= 0.99
        const image = s => /url\(/i.test(s['background-image'] || '')
        const backdrop = s => s['backdrop-filter'] && s['backdrop-filter'] !== 'none'
        const painted = s => parse(s['background-color']).a > 0 || (s['background-image'] && s['background-image'] !== 'none')
        const meaningful = s => s && s.content !== 'none' && s.content !== 'normal'
        const surfacePseudo = (r, p) => meaningful(p) && painted(p) && !image(p)
            && ['""', "''"].includes(p.content) && parseFloat(p.width) >= r.rect.width * 0.8
            && parseFloat(p.height) >= r.rect.height * 0.8 && r.rect.width > 0 && r.rect.height > 8
        const hasBar = r => Object.values(r.pseudos || {}).some(p => meaningful(p) && painted(p) && !image(p)
            && ['""', "''"].includes(p.content) && ((parseFloat(p.height) > 0 && parseFloat(p.height) <= 8) || (parseFloat(p.width) > 0 && parseFloat(p.width) <= 8)))
        const action = isAction

        function* planSteps(records, viewport = { width: 1024, height: 768 }, batchSize = 192) {
            const budget = Math.max(1, Math.floor(batchSize) || 192)
            let processed = 0
            const pause = () => ++processed % budget === 0
            const byNode = new Map(records.map(r => [r.node, r]))
            const children = new Map()
            const result = new Map()
            const raw = new Map()
            const contexts = new Map()
            const protectedRoots = new Set()
            const independent = new Set()
            const mediaForegrounds = new Set()
            const protectedNodes = new Map()
            const nextGroups = new Map(), nextResting = new Map()
            const codes = new Map()
            const usable = records.filter(r => r.style.display !== 'none' && r.style.visibility !== 'hidden')
            const usableNodes = new Set(usable.map(r => r.node))
            const groupAreas = new Map()
            for (const r of records) {
                if (!children.has(r.parent)) children.set(r.parent, [])
                children.get(r.parent).push(r)
                if (pause()) yield { processed }
            }
            function rawBackground(r) {
                const path = []
                while (r && !raw.has(r.node)) { path.push(r); r = byNode.get(r.parent) }
                let value = r ? raw.get(r.node) : WHITE
                for (let i = path.length - 1; i >= 0; i--) {
                    value = over(parse(path[i].style['background-color']), value)
                    raw.set(path[i].node, value)
                }
                return value
            }
            const ordered = []
            for (const r of records) {
                if (!byNode.has(r.parent)) ordered.push(r)
                if (pause()) yield { processed }
            }
            for (let i = 0; i < ordered.length; i++) for (const child of children.get(ordered[i].node) || []) {
                ordered.push(child)
                if (pause()) yield { processed }
            }
            for (const r of ordered) {
                rawBackground(r)
                if (pause()) yield { processed }
            }
            function protect(r) {
                if (!r) return
                if (!opaque(r) && !image(r.style) && !independent.has(r.node)) {
                    let ancestor = byNode.get(r.parent)
                    while (ancestor) {
                        if (image(ancestor.style)) { r = ancestor; break }
                        if (opaque(ancestor) || independent.has(ancestor.node)) break
                        ancestor = byNode.get(ancestor.parent)
                    }
                }
                protectedRoots.add(r.node)
            }
            for (const r of usable) {
                const s = r.style
                const pseudoImage = Object.values(r.pseudos || {}).some(p => meaningful(p) && image(p) && (parseFloat(p.width) > 64 || parseFloat(p.height) > 64))
                if (image(s) || pseudoImage || r.unsafe) protect(r)
                const backgroundMedia = image(s) && ['absolute', 'fixed'].includes(s.position)
                if (MEDIA.has(r.tag) || backgroundMedia) {
                    const parent = byNode.get(r.parent)
                    const fixedBackdrop = s.position === 'fixed' && r.rect.width >= viewport.width && r.rect.height >= viewport.height
                    const coversParent = parent && parent.rect.width > 0 && parent.rect.height > 0
                        && r.rect.left <= parent.rect.left && r.rect.top <= parent.rect.top
                        && r.rect.left + r.rect.width >= parent.rect.left + parent.rect.width
                        && r.rect.top + r.rect.height >= parent.rect.top + parent.rect.height
                    const overlays = child => child.node !== r.node && usableNodes.has(child.node) && parseFloat(child.style.opacity || '1') > 0
                        && (['absolute', 'fixed'].includes(child.style.position) || backgroundMedia && coversParent) && child.hasText
                        && child.rect.width > 0 && child.rect.height > 0
                        && child.rect.left < r.rect.left + r.rect.width && child.rect.left + child.rect.width > r.rect.left
                        && child.rect.top < r.rect.top + r.rect.height && child.rect.top + child.rect.height > r.rect.top
                    if (parent && !fixedBackdrop && !['html', 'body'].includes(parent.tag)) {
                        const foregrounds = (children.get(parent.node) || []).filter(overlays)
                        if (coversParent && foregrounds.length) {
                            if (backgroundMedia) independent.add(parent.node)
                            protect(parent)
                        }
                        else for (const foreground of foregrounds) {
                            protectedRoots.add(foreground.node)
                            mediaForegrounds.add(foreground.node)
                        }
                    }
                }
                if (pause()) yield { processed }
            }
            const svgColors = new Map()
            for (const r of records) {
                if (r.svgRoot) {
                    if (!svgColors.has(r.svgRoot)) svgColors.set(r.svgRoot, new Set())
                    for (const prop of ['fill', 'stroke']) if (parse(r.style[prop]).a > 0) svgColors.get(r.svgRoot).add(colorKey(parse(r.style[prop])))
                }
                if (pause()) yield { processed }
            }
            for (const [node, colors] of svgColors) if (colors.size > 2 && byNode.has(node)) protect(byNode.get(node))
            for (const [parent, siblings] of children) {
                if (pause()) yield { processed }
                const candidates = siblings.filter(r => usableNodes.has(r.node) && !MEDIA.has(r.tag))
                if (candidates.length < 2 || !parent) continue
                if (!groupCompatible(candidates)) continue
                let group = nextGroups.get(parent)
                if (!group) {
                    group = { clusters: [...(groups.get(parent)?.clusters || [])] }
                    nextGroups.set(parent, group)
                }
                const descriptions = []
                for (const r of candidates) {
                    if (!r.transient) nextResting.set(r.node, { ...r, style: { ...r.style }, pseudos: { ...r.pseudos } })
                    const baseline = r.transient && !r.selected ? nextResting.get(r.node) || resting.get(r.node) || r : r
                    const bg = over(parse(baseline.style['background-color']), rawBackground(byNode.get(baseline.parent)))
                    const fg = parse(baseline.style.color)
                    const key = colorKey(bg) + '|' + colorKey(fg) + '|' + Number(baseline.selected)
                        + '|' + SIDES.map(side => baseline.style[`border-${side}-width`] || '0').join(',')
                        + '|' + Object.entries(baseline.pseudos || {}).filter(([, p]) => surfacePseudo(baseline, p)).map(([name, p]) => name + (p['background-color'] || '')).join(',')
                    descriptions.push({ r, baseline, bg, fg, key })
                    if (pause()) yield { processed }
                }
                const frequencies = new Map()
                for (const d of descriptions) {
                    frequencies.set(d.key, (frequencies.get(d.key) || 0) + 1)
                    if (pause()) yield { processed }
                }
                const unique = [...new Map(descriptions.map(d => [d.key, d])).values()]
                if (unique.length > 4) {
                    group.clusters = []
                    for (const d of descriptions) {
                        codes.set(d.r.node, d.baseline.selected ? 1 : 0)
                        if (pause()) yield { processed }
                    }
                    continue
                }
                const parentBg = rawBackground(byNode.get(parent))
                unique.sort((a, b) => Number(a.baseline.selected) - Number(b.baseline.selected)
                    || distance(a.bg, parentBg) - distance(b.bg, parentBg)
                    || frequencies.get(b.key) - frequencies.get(a.key)
                    || Math.hypot(...lab(a.fg).slice(1)) - Math.hypot(...lab(b.fg).slice(1))
                    || a.key.localeCompare(b.key))
                for (const d of unique) {
                    let cluster = group.clusters.find(c => c.key === d.key
                        || (c.selected === d.baseline.selected && distance(c.bg, d.bg) < COLOR_DISTANCE && distance(c.fg, d.fg) < COLOR_DISTANCE && c.structure === d.key.split('|').slice(3).join('|')))
                    if (!cluster) {
                        const used = new Set(group.clusters.map(c => c.code))
                        const code = d.baseline.selected ? [1, 2, 3, 0].find(n => !used.has(n)) : [0, 1, 2, 3].find(n => !used.has(n))
                        cluster = { key: d.key, structure: d.key.split('|').slice(3).join('|'), bg: d.bg, fg: d.fg, selected: d.baseline.selected, code }
                        if (code === undefined) {
                            group.clusters = []
                            for (const item of descriptions) {
                                codes.set(item.r.node, item.baseline.selected ? 1 : 0)
                                if (pause()) yield { processed }
                            }
                            break
                        }
                        group.clusters.push(cluster)
                    }
                    for (const item of descriptions.filter(item => item.key === d.key)) {
                        codes.set(item.r.node, cluster.code)
                        if (pause()) yield { processed }
                    }
                }
            }
            function protectedNode(r) {
                return !!r && protectedNodes.get(r.node) === true
            }
            for (const r of ordered) {
                protectedNodes.set(r.node, protectedRoots.has(r.node) || protectedNodes.get(r.parent) === true)
                if (pause()) yield { processed }
            }
            for (const [parent, peers] of children) {
                const value = { indicators: 0, area: 0, fill: 0 }
                for (const peer of peers) {
                    const area = peer.rect.width * peer.rect.height
                    value.indicators += Number(hasBar(peer))
                    value.area += area
                    if ((codes.get(peer.node) || peer.selected) && !peer.disabled) value.fill += area
                    if (pause()) yield { processed }
                }
                groupAreas.set(parent, value)
            }
            function context(r) {
                const path = []
                while (r && !contexts.has(r.node)) { path.push(r); r = byNode.get(r.parent) }
                let parent = r ? contexts.get(r.node) : { bg: '#fff', fg: '#000' }
                for (let i = path.length - 1; i >= 0; i--) {
                    r = path[i]
                    const s = r.style
                    const own = painted(s) || backdrop(s) || Object.values(r.pseudos || {}).some(p => surfacePseudo(r, p))
                    const code = codes.get(r.node) || 0
                    const root = r.tag === 'html' || r.tag === 'body'
                    const rawParent = rawBackground(byNode.get(r.parent))
                    const baseline = nextResting.get(r.node) || resting.get(r.node)
                    const hoverChanged = r.transient && baseline && (distance(parse(s.color), parse(baseline.style.color)) > COLOR_DISTANCE || distance(rawBackground(r), over(parse(baseline.style['background-color']), rawParent)) > COLOR_DISTANCE)
                    const emphatic = !r.disabled && (r.selected || code > 0 || hoverChanged || (!codes.has(r.node) && action(r) && own && distance(rawBackground(r), rawParent) > COLOR_DISTANCE))
                    const small = r.rect.height <= MAX_FILL_HEIGHT && r.rect.width * r.rect.height <= viewport.width * viewport.height * MAX_FILL_AREA
                    const area = groupAreas.get(r.parent)
                    const budget = !codes.has(r.node) || !area || !area.area || area.fill <= area.area * MAX_GROUP_FILL
                    const transient = r.transient && !r.selected && resting.has(r.node) && (codes.get(r.node) || 0) === 0
                    const filled = emphatic && (r.selected || action(r)) && own && small && budget && code < 2 && !transient
                    const graphic = !root && !action(r) && !r.hasText && !r.hasChildren && own && !FORMS.has(r.tag) && r.rect.width <= MAX_FILL_HEIGHT && r.rect.height <= MAX_FILL_HEIGHT
                    const bg = graphic ? (C.brightness(rawBackground(r)) < 128 ? '#000' : '#fff')
                        : filled ? (parent.bg === '#000' ? '#fff' : '#000') : own || root ? '#fff' : parent.bg
                    const indicator = hasBar(r) && area && area.indicators === 1
                    const value = { bg, fg: bg === '#000' ? '#fff' : '#000', indicator, own, emphatic, filled, code, root, transient, graphic }
                    contexts.set(r.node, value)
                    parent = value
                }
                return parent
            }
            for (const r of ordered) {
                if (!protectedNode(r)) context(r)
                if (pause()) yield { processed }
            }
            for (const r of records) {
                if (pause()) yield { processed }
                const plans = {}
                result.set(r.node, { rules: plans, protected: protectedNode(r) })
                if (protectedNode(r)) {
                    if (protectedRoots.has(r.node) && !r.unsafe) {
                        const s = r.style
                        plans[''] = Object.fromEntries(['color', '-webkit-text-fill-color', 'fill', 'stroke'].filter(p => s[p]).map(p => [p, s[p]]))
                        if (!opaque(r) && !image(s) && r.hasText && !r.svg && !mediaForegrounds.has(r.node)) {
                            const bg = rawBackground(r)
                            plans['']['background-color'] = `rgb(${bg.r}, ${bg.g}, ${bg.b})`
                        }
                    }
                    continue
                }
                if (!usableNodes.has(r.node) || MEDIA.has(r.tag)) continue
                const s = r.style, c = context(r), props = {}
                plans[''] = props
                if (s.filter && s.filter !== 'none') props.filter = 'none'
                if (s['mix-blend-mode'] && s['mix-blend-mode'] !== 'normal') props['mix-blend-mode'] = 'normal'
                const setPaint = (key, value, original = s[key]) => {
                    const color = parse(original)
                    if (color.a > 0) props[key] = value
                }
                if (c.own || c.root) {
                    props['background-color'] = c.bg
                    if (s['background-image'] && s['background-image'] !== 'none') props['background-image'] = 'none'
                }
                if (!r.svg) {
                    setPaint('color', c.fg)
                    setPaint('-webkit-text-fill-color', c.fg)
                    if (FORMS.has(r.tag) || r.editable) {
                        props['caret-color'] = c.fg
                        props['accent-color'] = c.fg
                    }
                    props['text-shadow'] = 'none'
                }
                for (const prop of ['fill', 'stroke']) {
                    if (s[prop] !== 'none') setPaint(prop, c.fg)
                }
                if (!r.hasText && !r.hasChildren && !FORMS.has(r.tag) && !r.editable
                    && (s['mask-image'] && s['mask-image'] !== 'none' || s['-webkit-mask-image'] && s['-webkit-mask-image'] !== 'none')) props['background-color'] = context(byNode.get(r.parent)).fg
                for (const side of SIDES) if (parseFloat(s[`border-${side}-width`]) > 0
                    && parse(s[`border-${side}-color`]).a >= MIN_BORDER_ALPHA) props[`border-${side}-color`] = c.fg
                if (s['outline-style'] && s['outline-style'] !== 'none') setPaint('outline-color', c.fg)
                if (s['text-decoration-line'] && s['text-decoration-line'] !== 'none') props['text-decoration-color'] = c.fg
                if (r.tag === 'a' && r.hasText && !c.own && !c.emphatic && (!s['text-decoration-line'] || s['text-decoration-line'] === 'none')) props['text-decoration-line'] = 'underline'
                if (s['box-shadow'] && s['box-shadow'] !== 'none') props['box-shadow'] = C.newBoxShadow(s['box-shadow']) || s['box-shadow']
                if (s['background-clip'] === 'text' || s['-webkit-background-clip'] === 'text') {
                    props['background-image'] = 'none'
                    props['background-color'] = 'transparent'
                    props['-webkit-text-fill-color'] = c.fg
                }
                if ((c.emphatic || (action(r) && c.own)) && !c.filled && !c.graphic && !c.indicator && !r.disabled) {
                    if (c.code >= 2 && (!s['outline-style'] || s['outline-style'] === 'none') && !r.focus) {
                        props['outline-width'] = '2px'
                        props['outline-style'] = c.code === 2 ? 'dashed' : 'double'
                        props['outline-color'] = c.fg
                        props['outline-offset'] = '0'
                    } else {
                        const line = `inset 0 0 0 2px ${c.fg}`
                        props['box-shadow'] = props['box-shadow'] ? props['box-shadow'] + ',' + line : line
                    }
                }
                if (r.focus) {
                    props['outline-width'] = '2px'
                    props['outline-style'] = 'solid'
                    props['outline-color'] = '#000'
                    props['outline-offset'] = '4px'
                    const halo = '0 0 0 4px #fff'
                    props['box-shadow'] = props['box-shadow'] ? props['box-shadow'] + ',' + halo : halo
                }
                if (c.graphic && c.bg === context(byNode.get(r.parent)).bg && distance(rawBackground(r), rawBackground(byNode.get(r.parent))) > COLOR_DISTANCE) props['box-shadow'] = `inset 0 0 0 2px ${c.fg}`
                if (c.root) props['color-scheme'] = 'light'
                for (const [name, p] of Object.entries(r.pseudos || {})) {
                    if (name !== '::placeholder' && !meaningful(p) || image(p)) continue
                    const pp = {}, pc = parse(p['background-color'])
                    if (p.filter && p.filter !== 'none') pp.filter = 'none'
                    if (p['mix-blend-mode'] && p['mix-blend-mode'] !== 'normal') pp['mix-blend-mode'] = 'normal'
                    const hasPaint = painted(p)
                    const text = p.content && !['""', "''", 'none', 'normal'].includes(p.content)
                    const bar = hasPaint && !text && ((parseFloat(p.height) > 0 && parseFloat(p.height) <= 8)
                        || (parseFloat(p.width) > 0 && parseFloat(p.width) <= 8))
                    const wash = pc.a < 0.15 && !text && !bar
                    const pseudoBg = pc.a > 0 && !wash ? (bar ? c.fg : surfacePseudo(r, p) ? c.bg : '#fff') : c.bg
                    const fg = pseudoBg === '#000' ? '#fff' : '#000'
                    if (pc.a > 0) pp['background-color'] = wash ? 'transparent' : pseudoBg
                    if (hasPaint && p['background-image'] && p['background-image'] !== 'none') pp['background-image'] = 'none'
                    if (parse(p.color).a > 0) pp.color = fg
                    if (parse(p['-webkit-text-fill-color']).a > 0) pp['-webkit-text-fill-color'] = fg
                    if (!text && (p['mask-image'] && p['mask-image'] !== 'none' || p['-webkit-mask-image'] && p['-webkit-mask-image'] !== 'none')) pp['background-color'] = c.fg
                    if (name === '::placeholder') pp.color = c.fg
                    for (const side of SIDES) if (parseFloat(p[`border-${side}-width`]) > 0
                        && parse(p[`border-${side}-color`]).a >= MIN_BORDER_ALPHA) pp[`border-${side}-color`] = fg
                    if (p['background-clip'] === 'text' || p['-webkit-background-clip'] === 'text') {
                        pp['background-image'] = 'none'
                        pp['background-color'] = 'transparent'
                        pp['-webkit-text-fill-color'] = fg
                    }
                    pp['text-shadow'] = 'none'
                    plans[name] = pp
                }
            }
            for (const [node, group] of nextGroups) groups.set(node, group)
            for (const [node, value] of nextResting) resting.set(node, value)
            return result
        }
        function plan(records, viewport) {
            const steps = planSteps(records, viewport)
            let next
            do { next = steps.next() } while (!next.done)
            return next.value
        }
        return { plan, planSteps, reset() { groups = new WeakMap(); resting = new WeakMap() } }
    }

    const api = { createPlanner, groupCompatible, transitionPlan, createTransitionCache, paintProperty, PAINT, SOURCE, BASE_RULES, over, lab, distance }
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else globalThis.EinkContrast = api
})()

const keys = ['styleReads', 'mainStyleReads', 'pseudoStyleReads', 'geometryReads', 'queryCalls', 'queryResults',
    'attributeWrites', 'hookWrites', 'inlineWrites', 'inlinePriorityReads', 'cssomWrites', 'stylesheetTextWrites',
    'stylesheetTextCharacters', 'parsedRules', 'sheetToggles', 'domInsertions', 'domRemovals', 'plannerCalls',
    'plannerRecords', 'plannerSteps']

const zero = () => Object.fromEntries(keys.map(key => [key, 0]))
const subtract = (after, before) => Object.fromEntries(keys.map(key => [key, after[key] - before[key]]))
const base = {
    color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)',
    'background-image': 'none', 'background-clip': 'border-box', '-webkit-background-clip': 'border-box',
    'caret-color': 'auto', 'accent-color': 'auto', display: 'block', visibility: 'visible', position: 'static',
    opacity: '1', fill: 'none', stroke: 'none', 'box-shadow': 'none', 'text-shadow': 'none', 'outline-style': 'none',
    'outline-width': '0px', 'outline-color': 'rgb(0, 0, 0)', 'mix-blend-mode': 'normal', filter: 'none',
    'backdrop-filter': 'none', content: 'none', 'transition-property': 'all', 'transition-duration': '0s',
    'transition-delay': '0s', 'transition-timing-function': 'ease', 'transition-behavior': 'normal',
    'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px',
    'border-top-color': 'rgb(0, 0, 0)', 'border-right-color': 'rgb(0, 0, 0)',
    'border-bottom-color': 'rgb(0, 0, 0)', 'border-left-color': 'rgb(0, 0, 0)'
}

function createComparisonDocument() {
    const totals = zero(), frames = [], observers = [], listeners = new WeakMap(), sheets = new Set(), selectors = new Map(), aliases = new Map()
    let recording = false, author = false, clock = 0, periodic
    const add = (key, value = 1) => { if (recording && !author) totals[key] += value }
    const contains = (root, node) => {
        for (let current = node; current; current = current.parentElement) if (current === root) return true
        return root.nodeType === 9 && node.getRootNode() === root
    }
    const notify = record => {
        for (const observer of observers) {
            if (!observer.root || !contains(observer.root, record.target)) continue
            if (!observer.options.subtree && observer.root !== record.target) continue
            if (record.type === 'attributes' && (!observer.options.attributes
                || (observer.options.attributeFilter && !observer.options.attributeFilter.includes(record.attributeName)))) continue
            if (record.type === 'childList' && !observer.options.childList) continue
            observer.records.push(record)
        }
    }
    function eventTarget(target) {
        listeners.set(target, new Map())
        target.addEventListener = (name, handler) => {
            const events = listeners.get(target)
            if (!events.has(name)) events.set(name, new Set())
            events.get(name).add(handler)
        }
        target.removeEventListener = (name, handler) => listeners.get(target).get(name)?.delete(handler)
        target.emit = (name, element = target) => {
            for (const handler of listeners.get(target).get(name) || []) {
                handler({ type: name, target: element, composedPath: () => [element] })
            }
        }
        return target
    }
    const doc = eventTarget({ nodeType: 9, hidden: false, readyState: 'complete' })
    function declaration(target, rule = false) {
        const values = new Map()
        const parse = text => {
            values.clear()
            for (const item of text.split(';')) {
                const colon = item.indexOf(':')
                if (colon < 0) continue
                const key = item.slice(0, colon).trim(), raw = item.slice(colon + 1).trim()
                values.set(key, { value: raw.replace(/\s*!important$/, ''), priority: /!important$/.test(raw) ? 'important' : '' })
            }
        }
        const serialize = () => [...values].map(([key, item]) => `${key}:${item.value}${item.priority ? '!important' : ''}`).join(';')
        const update = operation => {
            if (rule) add('cssomWrites')
            else if (target?.isConnected) add('inlineWrites')
            const oldValue = target?.getAttribute('style') || null
            operation()
            if (target) {
                target.attrs.set('style', serialize())
                notify({ type: 'attributes', target, attributeName: 'style', oldValue })
            }
        }
        return {
            values,
            getPropertyValue: name => values.get(name)?.value || '',
            getPropertyPriority(name) { if (target?.isConnected) add('inlinePriorityReads'); return values.get(name)?.priority || '' },
            setProperty: (name, value, priority = '') => update(() => values.set(name, { value, priority })),
            removeProperty: name => update(() => values.delete(name)),
            get cssText() { return serialize() },
            set cssText(text) { update(() => parse(text)) }
        }
    }
    const descendants = root => {
        const result = [], pending = [...root.children].reverse()
        while (pending.length) {
            const next = pending.pop()
            result.push(next)
            for (let i = next.children.length - 1; i >= 0; i--) pending.push(next.children[i])
        }
        return result
    }
    const parseRules = text => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => {
        const style = declaration(null, true)
        const previous = recording
        recording = false
        style.cssText = match[2]
        recording = previous
        let selector = match[1].trim()
        return { style, get selectorText() { return selector }, set selectorText(value) { add('cssomWrites'); selector = value } }
    })
    function element(tag, parent, source = {}) {
        const el = eventTarget({ nodeType: 1, localName: tag, tagName: tag.toUpperCase(), ownerDocument: doc,
            attrs: new Map(), children: [], parentElement: null, namespaceURI: 'http://www.w3.org/1999/xhtml',
            textContent: tag === 'style' ? '' : 'Text', tabIndex: tag === 'button' ? 0 : -1,
            rect: { width: 120, height: 32, left: 0, top: 0 }, source, focus: false, hover: false })
        Object.defineProperties(el, {
            isConnected: { get: () => el === doc.documentElement || !!el.parentElement?.isConnected },
            childElementCount: { get: () => el.children.length },
            parentNode: { get: () => el.parentElement }
        })
        el.getRootNode = () => el.parentElement ? el.parentElement.getRootNode() : (el === doc.documentElement ? doc : el)
        el.getAttribute = name => el.attrs.get(name) ?? null
        el.setAttribute = (name, value) => {
            add('attributeWrites')
            if (name.startsWith('data-eink-')) add('hookWrites')
            const oldValue = el.getAttribute(name)
            el.attrs.set(name, String(value))
            notify({ type: 'attributes', target: el, attributeName: name, oldValue })
        }
        el.removeAttribute = name => {
            add('attributeWrites')
            if (name.startsWith('data-eink-')) add('hookWrites')
            const oldValue = el.getAttribute(name)
            el.attrs.delete(name)
            notify({ type: 'attributes', target: el, attributeName: name, oldValue })
        }
        el.querySelectorAll = () => { const result = descendants(el); add('queryCalls'); add('queryResults', result.length); return result }
        el.getBoundingClientRect = () => { add('geometryReads'); return { ...el.rect, bottom: el.rect.top + el.rect.height, right: el.rect.left + el.rect.width } }
        el.matches = query => query === ':focus-visible' ? el.focus : query === ':hover,:active' ? el.hover : false
        el.appendChild = child => {
            add('domInsertions')
            if (child.parentElement) child.remove()
            child.parentElement = el
            el.children.push(child)
            notify({ type: 'childList', target: el, addedNodes: [child], removedNodes: [] })
            return child
        }
        el.remove = () => {
            if (!el.parentElement) return
            add('domRemovals')
            const parent = el.parentElement
            parent.children.splice(parent.children.indexOf(el), 1)
            el.parentElement = null
            if (el.sheet) el.sheet.cssRules.length = 0
            notify({ type: 'childList', target: parent, addedNodes: [], removedNodes: [el] })
        }
        el.style = declaration(el)
        if (tag === 'style') {
            let disabled = false, text = ''
            el.sheet = {
                cssRules: [],
                get disabled() { return disabled },
                set disabled(value) { if (disabled !== value) add('sheetToggles'); disabled = value },
                insertRule(value, index) { add('cssomWrites'); this.cssRules.splice(index, 0, ...parseRules(value)); return index },
                deleteRule(index) { add('cssomWrites'); this.cssRules.splice(index, 1) }
            }
            const assign = value => {
                add('stylesheetTextWrites')
                add('stylesheetTextCharacters', value.length)
                text = value
                const rules = parseRules(value)
                add('parsedRules', rules.length)
                el.sheet.cssRules.splice(0, el.sheet.cssRules.length, ...rules)
            }
            Object.defineProperty(el, 'textContent', { get: () => text, set: assign })
            el.append = value => assign(text + value)
            sheets.add(el)
        }
        if (parent) parent.appendChild(el)
        return el
    }
    doc.documentElement = element('html', null, { 'background-color': 'rgb(255, 255, 255)' })
    doc.body = element('body', doc.documentElement)
    doc.querySelectorAll = () => {
        const result = [doc.documentElement, ...descendants(doc.documentElement)]
        add('queryCalls'); add('queryResults', result.length)
        return result
    }
    doc.createElement = tag => element(tag)
    doc.defaultView = eventTarget({ innerWidth: 1024, innerHeight: 768,
        performance: { now: () => ++clock }, console: { warn() {} },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.records = []; observers.push(this) }
            observe(root, options) { this.root = root; this.options = options }
            disconnect() { this.root = null; this.records = [] }
            takeRecords() { return this.records.splice(0) }
        }
    })
    function match(selector, el, pseudo) {
        if (!selectors.has(selector)) selectors.set(selector, {
            root: selector === ':root' || selector === 'html',
            excluded: selector.includes('::selection') || selector.includes('::-webkit-scrollbar'),
            suffix: selector.match(/::[\w-]+$/)?.[0] || '',
            token: selector.match(/\[data-eink-contrast~="([^"]+)"\]/)?.[1],
            oldToken: selector.match(/\[data-eink-p="([^"]+)"\]/)?.[1],
            wildcard: selector.startsWith('*:not(#eink):not(#eink):not(#eink)'),
            interaction: /:(hover|active|focus|focus-visible)(?:$|,|\s)/.test(selector)
        })
        const parsed = selectors.get(selector)
        if (parsed.root) return !pseudo && el === doc.documentElement
        if (parsed.excluded || parsed.suffix !== pseudo) return false
        if (parsed.token) return (' ' + (el.getAttribute('data-eink-contrast') || '') + ' ').includes(' ' + parsed.token + ' ')
        if (parsed.oldToken) return el.getAttribute('data-eink-p') === parsed.oldToken
        if (!parsed.wildcard) return false
        if (parsed.interaction) return el.hover || el.focus
        return true
    }
    function painted(el, pseudo = '') {
        const values = { ...base, ...(pseudo ? el.pseudos?.[pseudo] : el.source) }
        if (!pseudo && el.hover && el.hoverSource) Object.assign(values, el.hoverSource)
        const apply = (prop, value) => {
            if (value === '#000') value = 'rgb(0, 0, 0)'
            if (value === '#fff') value = 'rgb(255, 255, 255)'
            if (value === 'transparent') value = 'rgba(0, 0, 0, 0)'
            if (prop === 'background') { values['background-color'] = value; values['background-image'] = 'none' }
            else values[prop] = value
        }
        for (const sheet of sheets) {
            if (!sheet.isConnected || sheet.sheet.disabled) continue
            for (const rule of sheet.sheet.cssRules) if (rule.style.values.size && match(rule.selectorText, el, pseudo)) {
                for (const [prop, item] of rule.style.values) apply(prop, item.value)
            }
        }
        if (!pseudo) for (const [prop, item] of el.style.values) apply(prop, item.value)
        return values
    }
    function styles(el, pseudo = '') {
        add('styleReads'); add(pseudo ? 'pseudoStyleReads' : 'mainStyleReads')
        const values = painted(el, pseudo), props = Object.keys(values)
        const result = { ...values, length: props.length, getPropertyValue: prop => values[prop] || '',
            [Symbol.iterator]: () => props[Symbol.iterator]() }
        props.forEach((prop, index) => {
            result[index] = prop
            if (!aliases.has(prop)) aliases.set(prop, [prop.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
                ...(prop.startsWith('-webkit-') ? ['webkit' + prop.slice(8).replace(/(^|-)([a-z])/g, (_, prefix, letter) => letter.toUpperCase())] : [])])
            for (const alias of aliases.get(prop)) result[alias] = values[prop]
        })
        return result
    }
    function deliver() {
        let delivered = false
        for (const observer of observers) {
            const records = observer.takeRecords()
            if (records.length) { observer.callback(records); delivered = true }
        }
        return delivered
    }
    function phase(trigger) {
        const before = { ...totals }, maxPerFrame = zero()
        recording = true
        trigger()
        deliver()
        const synchronous = subtract(totals, before)
        let frameCount = 0
        while (frames.length) {
            if (++frameCount > 20000) throw Error('The engine did not finish the deterministic frame queue')
            const frameBefore = { ...totals }
            frames.shift()()
            const delta = subtract(totals, frameBefore)
            for (const key of keys) maxPerFrame[key] = Math.max(maxPerFrame[key], delta[key])
            deliver()
        }
        recording = false
        return { ...subtract(totals, before), frames: frameCount, synchronous, maxPerFrame }
    }
    return {
        doc, element, styles, painted, phase, add,
        author(operation) { author = true; try { return operation() } finally { author = false } },
        schedule: callback => frames.push(callback),
        repeat(callback) { periodic = callback; return 1 },
        cancelRepeat() { periodic = undefined },
        tick: () => periodic?.(),
        nodeCount: () => 1 + descendants(doc.documentElement).filter(el => el.localName !== 'style').length
    }
}

module.exports = { createComparisonDocument, keys }

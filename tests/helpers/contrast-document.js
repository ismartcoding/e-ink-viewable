const Policy = require('../../src/contrast.js')
const Inline = require('../../src/contrast-inline.js')
const C = require('../../src/color.js')
const Dom = require('../../src/contrast-dom.js')

function createDocument({ batchSize = 192 } = {}) {
    const frames = [], observers = [], events = new WeakMap()
    let periodic, cancelled = 0, clock = 0
    function eventTarget(target) {
        events.set(target, new Map())
        target.addEventListener = (name, fn) => {
            const handlers = events.get(target)
            if (!handlers.has(name)) handlers.set(name, new Set())
            handlers.get(name).add(fn)
        }
        target.removeEventListener = (name, fn) => events.get(target).get(name)?.delete(fn)
        target.emit = (name, el = target, extra = {}) => {
            for (const fn of events.get(target).get(name) || []) fn({ type: name, target: el, composedPath: () => [el], ...extra })
        }
        return target
    }
    const doc = eventTarget({ nodeType: 9, hidden: false })
    const notify = record => {
        for (const observer of observers) if (observer.root && record.target.getRootNode() === observer.root) observer.records.push(record)
    }
    function style(target) {
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
        const serialize = () => [...values].map(([key, p]) => `${key}:${p.value}${p.priority ? '!important' : ''}`).join(';')
        const update = fn => {
            const oldValue = target?.getAttribute('style') || null
            fn()
            if (target) { target.attrs.set('style', serialize()); notify({ type: 'attributes', target, attributeName: 'style', oldValue }) }
        }
        return {
            getPropertyValue: prop => values.get(prop)?.value || '',
            getPropertyPriority: prop => values.get(prop)?.priority || '',
            setProperty: (key, value, priority = '') => update(() => values.set(key, { value, priority })),
            removeProperty: key => update(() => values.delete(key)),
            get cssText() { return serialize() },
            set cssText(text) { update(() => parse(text)) }
        }
    }
    function descendants(root) { return root.children.flatMap(el => [el, ...descendants(el)]) }
    function element(tag, parent, source = {}) {
        const el = eventTarget({ nodeType: 1, localName: tag, ownerDocument: doc, attrs: new Map(), children: [], parentElement: null,
            namespaceURI: 'http://www.w3.org/1999/xhtml', textContent: 'Text', tabIndex: tag === 'button' ? 0 : -1,
            rect: { width: 120, height: 32, left: 0, top: 0 }, source, focus: false, hover: false })
        el.style = style(el)
        Object.defineProperties(el, {
            isConnected: { get: () => el === doc.documentElement || !!el.parentElement?.isConnected || !!el.root?.host?.isConnected },
            childElementCount: { get: () => el.children.length }
        })
        el.getRootNode = () => el.parentElement ? el.parentElement.getRootNode() : el.root || (el === doc.documentElement ? doc : el)
        el.getAttribute = name => el.attrs.get(name) ?? null
        el.setAttribute = (name, value) => { const oldValue = el.getAttribute(name); el.attrs.set(name, String(value)); notify({ type: 'attributes', target: el, attributeName: name, oldValue }) }
        el.removeAttribute = name => { const oldValue = el.getAttribute(name); el.attrs.delete(name); notify({ type: 'attributes', target: el, attributeName: name, oldValue }) }
        el.querySelectorAll = () => descendants(el)
        el.getBoundingClientRect = () => ({ ...el.rect, bottom: el.rect.top + el.rect.height, right: el.rect.left + el.rect.width })
        el.matches = query => query === ':focus-visible' ? el.focus : query === ':hover,:active' ? el.hover : false
        el.appendChild = child => {
            child.parentElement = el; el.children.push(child)
            notify({ type: 'childList', target: el, addedNodes: [child], removedNodes: [] })
            return child
        }
        el.remove = () => {
            const parent = el.parentElement || el.root
            if (!parent) return
            parent.children.splice(parent.children.indexOf(el), 1); el.parentElement = null; el.root = null
            if (el.sheet) el.sheet.cssRules.length = 0
            notify({ type: 'childList', target: parent, addedNodes: [], removedNodes: [el] })
        }
        if (tag === 'style') {
            el.sheet = { disabled: false, cssRules: [],
                insertRule(text, index) {
                    const brace = text.indexOf('{'), rule = { selectorText: text.slice(0, brace), style: style() }
                    rule.style.cssText = text.slice(brace + 1, -1)
                    this.cssRules.splice(index, 0, rule)
                    return index
                }, deleteRule(index) { this.cssRules.splice(index, 1) } }
        }
        if (parent) parent.appendChild(el)
        return el
    }
    doc.documentElement = element('html', null, { 'background-color': 'rgb(255, 255, 255)' })
    doc.body = element('body', doc.documentElement)
    doc.querySelectorAll = () => [doc.documentElement, ...descendants(doc.documentElement)]
    doc.createElement = tag => element(tag)
    const view = eventTarget({ innerWidth: 1024, innerHeight: 768, performance: { now: () => ++clock }, console: { warn() {} },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.records = []; observers.push(this) }
            observe(root) { this.root = root }
            disconnect() { this.root = null; this.records = [] }
            takeRecords() { return this.records.splice(0) }
        } })
    doc.defaultView = view
    const base = { color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)',
        'background-image': 'none', display: 'block', visibility: 'visible', position: 'static', opacity: '1',
        fill: 'none', stroke: 'none', 'box-shadow': 'none', 'text-shadow': 'none', 'outline-style': 'none', 'mix-blend-mode': 'normal',
        filter: 'none', 'backdrop-filter': 'none', content: 'none', 'transition-property': 'all',
        'transition-duration': '0s', 'transition-delay': '0s', 'transition-timing-function': 'ease', 'transition-behavior': 'normal' }
    function painted(el, pseudo = '') {
        const values = { ...base, ...(pseudo ? el.pseudos?.[pseudo] : el.source) }
        const root = el.getRootNode()
        const sheets = descendants(root === doc ? doc.documentElement : root).filter(e => e.localName === 'style' && !e.sheet.disabled)
        for (const sheet of sheets) for (const rule of sheet.sheet.cssRules) {
            const token = rule.selectorText.match(/data-eink-contrast~="([^"]+)"/)?.[1]
            const rootRule = rule.selectorText === ':root' && el === doc.documentElement
            if (!rootRule && (!token || !(el.getAttribute('data-eink-contrast') || '').split(' ').includes(token))) continue
            const suffix = rootRule ? '' : rule.selectorText.slice(rule.selectorText.lastIndexOf(']') + 1)
            if (suffix !== pseudo) continue
            for (const prop of [...Policy.SOURCE, 'color-scheme', 'scrollbar-color']) if (rule.style.getPropertyValue(prop)) values[prop] = rule.style.getPropertyValue(prop)
        }
        if (!pseudo) for (const prop of Policy.SOURCE) if (el.style.getPropertyValue(prop)) values[prop] = el.style.getPropertyValue(prop)
        return values
    }
    const styles = (el, pseudo) => {
        const values = painted(el, pseudo)
        const props = Object.keys(values)
        const cs = { ...values, getPropertyValue: p => values[p] || '', length: props.length, [Symbol.iterator]: () => props[Symbol.iterator]() }
        props.forEach((p, i) => { cs[i] = p; cs[p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = values[p] })
        return cs
    }
    const engine = Dom.createContrastEngine(C, Policy, { styles, batchSize, schedule: fn => frames.push(fn),
        repeat: fn => { periodic = fn; return 1 }, cancelRepeat: () => { cancelled++; periodic = null }, createInlineStyles: Inline.createInlineStyles })
    const flush = () => {
        for (let i = 0; frames.length; i++) {
            if (i > 200) throw Error('Scheduled work did not settle')
            frames.shift()()
        }
    }
    const mutations = () => { for (const o of observers) { const records = o.takeRecords(); if (records.length) o.callback(records) } }
    const shadow = host => {
        const root = eventTarget({ nodeType: 11, host, ownerDocument: doc, children: [], getRootNode() { return this } })
        root.querySelectorAll = () => descendants(root)
        root.appendChild = child => { child.root = root; root.children.push(child); return child }
        host.shadowRoot = root
        return root
    }
    return { doc, view, engine, element, shadow, painted, frames, flush, mutations, tick: () => periodic?.(), cancelled: () => cancelled,
        start() { engine.start(doc); flush() } }
}
module.exports = { createDocument }

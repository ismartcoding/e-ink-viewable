const Dom = require('../../src/high-contrast/contrast-dom.js')
const { createDocument } = require('./contrast-document')

function createPerformanceDocument(options) {
    let counts, f, statsBefore, frameMembers
    const byNode = new Map()
    const inlineByNode = new Map()
    const plannedByNode = new Map()
    const hookReadsByNode = new Map()
    const priorityByNode = new Map()
    const rootsByNode = new Map()
    const sampledRules = new Set()
    const pausedRules = new Set()
    const sampledTokens = new Map()
    const tokenMembers = new Map()
    const sampledMembers = new Set()
    const reset = () => {
        counts = { sourceReads: 0, mainReads: 0, pseudoReads: 0, rectReads: 0, attributeWrites: 0, hookWrites: 0,
            inlineWrites: 0, cssomWrites: 0, samplingCssomWrites: 0, samplingPauses: 0, samplingResumes: 0,
            sheetToggles: 0, queryCalls: 0, queriedNodes: 0, maxFrameSourceReads: 0, maxFrameSamplingMembers: 0,
            planCalls: 0, plannedRecords: 0, maxPlanRecords: 0, hookReads: 0, priorityReads: 0, rootReads: 0, maxSamplingMembers: 0 }
        byNode.clear()
        inlineByNode.clear()
        plannedByNode.clear()
        hookReadsByNode.clear()
        priorityByNode.clear()
        rootsByNode.clear()
        sampledRules.clear()
        pausedRules.clear()
        sampledTokens.clear()
        sampledMembers.clear()
        statsBefore = f?.engine.stats() || { writes: 0, samplingWrites: 0 }
    }
    reset()
    const originalEngine = Dom.createContrastEngine
    Dom.createContrastEngine = (C, Policy, settings) => originalEngine(C, { ...Policy,
        createPlanner(...args) {
            const planner = Policy.createPlanner(...args)
            let depth = 0
            for (const name of ['plan', 'planSteps']) {
                if (!planner[name]) continue
                const call = planner[name]
                planner[name] = (...params) => {
                    if (!depth) {
                        const records = params[0]
                        counts.planCalls++
                        counts.plannedRecords += records.length
                        counts.maxPlanRecords = Math.max(counts.maxPlanRecords, records.length)
                        for (const record of records) plannedByNode.set(record.node, (plannedByNode.get(record.node) || 0) + 1)
                    }
                    depth++
                    try { return call.apply(planner, params) }
                    finally { depth-- }
                }
            }
            return planner
        } }, { ...settings,
        schedule(fn) {
            return settings.schedule(() => {
                const before = counts.sourceReads
                const parentMembers = frameMembers
                frameMembers = new Set()
                try { return fn() }
                finally {
                    counts.maxFrameSourceReads = Math.max(counts.maxFrameSourceReads, counts.sourceReads - before)
                    counts.maxFrameSamplingMembers = Math.max(counts.maxFrameSamplingMembers, frameMembers.size)
                    frameMembers = parentMembers
                }
            })
        },
        styles(el, pseudo) {
            counts.sourceReads++
            counts[pseudo ? 'pseudoReads' : 'mainReads']++
            byNode.set(el, (byNode.get(el) || 0) + 1)
            return settings.styles(el, pseudo)
        } })
    try { f = createDocument(options) }
    finally { Dom.createContrastEngine = originalEngine }
    const wrapped = new WeakSet()
    const wrapQuery = target => {
        const query = target.querySelectorAll
        target.querySelectorAll = (...args) => {
            const result = query(...args)
            counts.queryCalls++
            counts.queriedNodes += result.length
            return result
        }
    }
    const wrapElement = el => {
        if (wrapped.has(el)) return el
        wrapped.add(el)
        const attribute = el.getAttribute
        el.getAttribute = name => {
            if (name === 'data-eink-contrast') {
                counts.hookReads++
                hookReadsByNode.set(el, (hookReadsByNode.get(el) || 0) + 1)
            }
            return attribute(name)
        }
        const priority = el.style.getPropertyPriority
        el.style.getPropertyPriority = prop => {
            counts.priorityReads++
            priorityByNode.set(el, (priorityByNode.get(el) || 0) + 1)
            return priority(prop)
        }
        const root = el.getRootNode
        el.getRootNode = () => {
            counts.rootReads++
            rootsByNode.set(el, (rootsByNode.get(el) || 0) + 1)
            return root()
        }
        for (const name of ['setAttribute', 'removeAttribute']) {
            const call = el[name]
            el[name] = (...args) => {
                counts.attributeWrites++
                if (args[0] === 'data-eink-contrast') counts.hookWrites++
                const before = args[0] === Dom.HOOK ? (attribute(Dom.HOOK) || '').split(/\s+/) : []
                const result = call(...args)
                if (args[0] === Dom.HOOK) {
                    for (const token of before) tokenMembers.get(token)?.delete(el)
                    for (const token of (attribute(Dom.HOOK) || '').split(/\s+/)) {
                        if (!token) continue
                        if (!tokenMembers.has(token)) tokenMembers.set(token, new Set())
                        tokenMembers.get(token).add(el)
                    }
                }
                return result
            }
        }
        for (const name of ['setProperty', 'removeProperty']) {
            const call = el.style[name]
            el.style[name] = (...args) => {
                counts.inlineWrites++
                inlineByNode.set(el, (inlineByNode.get(el) || 0) + 1)
                return call(...args)
            }
        }
        const rect = el.getBoundingClientRect
        el.getBoundingClientRect = () => { counts.rectReads++; return rect() }
        wrapQuery(el)
        if (el.sheet) {
            let disabled = el.sheet.disabled
            Object.defineProperty(el.sheet, 'disabled', { get: () => disabled,
                set(value) { if (value !== disabled) counts.sheetToggles++; disabled = value } })
            const insert = el.sheet.insertRule, remove = el.sheet.deleteRule
            el.sheet.insertRule = (text, index) => {
                counts.cssomWrites++
                const result = insert.call(el.sheet, text, index)
                const rule = el.sheet.cssRules[result], style = rule.style
                const descriptor = Object.getOwnPropertyDescriptor(style, 'cssText')
                Object.defineProperty(style, 'cssText', { ...descriptor,
                    set(value) {
                        counts.cssomWrites++
                        const before = descriptor.get.call(style)
                        const clearing = before !== '' && value === ''
                        const resuming = before === '' && value !== '' && pausedRules.has(rule)
                        if (clearing || resuming) {
                            counts.samplingCssomWrites++
                            counts[clearing ? 'samplingPauses' : 'samplingResumes']++
                            sampledRules.add(rule)
                            const token = rule.selectorText.match(/data-eink-contrast~="([^"]+)"/)?.[1]
                            if (token) sampledTokens.set(token, (sampledTokens.get(token) || 0) + 1)
                            if (clearing) {
                                for (const member of tokenMembers.get(token) || []) {
                                    sampledMembers.add(member)
                                    frameMembers?.add(member)
                                }
                                counts.maxSamplingMembers = Math.max(counts.maxSamplingMembers, sampledMembers.size)
                            }
                            if (clearing) pausedRules.add(rule)
                            else pausedRules.delete(rule)
                        }
                        descriptor.set.call(style, value)
                    } })
                return result
            }
            el.sheet.deleteRule = index => { counts.cssomWrites++; return remove.call(el.sheet, index) }
        }
        return el
    }
    wrapElement(f.doc.documentElement)
    wrapElement(f.doc.body)
    wrapQuery(f.doc)
    const originalElement = f.element
    f.element = (...args) => wrapElement(originalElement(...args))
    const originalCreate = f.doc.createElement
    f.doc.createElement = (...args) => wrapElement(originalCreate(...args))
    const originalShadow = f.shadow
    f.shadow = host => { const root = originalShadow(host); wrapQuery(root); return root }
    return { ...f, resetCounts: reset, counts: () => ({ ...counts, outputRuleWrites: f.engine.stats().writes - statsBefore.writes,
        samplingRuleWrites: (f.engine.stats().samplingWrites || 0) - (statsBefore.samplingWrites || 0), samplingGroups: sampledRules.size }), readsFor: el => byNode.get(el) || 0,
        inlineWritesFor: el => inlineByNode.get(el) || 0, plannedFor: el => plannedByNode.get(el) || 0,
        hookReadsFor: el => hookReadsByNode.get(el) || 0, priorityReadsFor: el => priorityByNode.get(el) || 0,
        rootReadsFor: el => rootsByNode.get(el) || 0,
        samplingWritesFor: el => (el.attrs.get(Dom.HOOK) || '').split(/\s+/).reduce((sum, token) => sum + (sampledTokens.get(token) || 0), 0),
        samplingMembers: () => [...sampledMembers],
        paintGroupSizes: () => [...tokenMembers].filter(([token, members]) => /^p\d+$/.test(token) && members.size).map(([, members]) => members.size) }
}

module.exports = { createPerformanceDocument }

(() => {
    'use strict'

    const INHERITED = new Set(['color', '-webkit-text-fill-color', 'fill', 'stroke', 'caret-color', 'accent-color', 'text-shadow'])
    const COLORS = new Set(['fill', 'stroke', 'caret-color', 'accent-color'])
    const NAMED = {
        '#000': { r: 0, g: 0, b: 0, a: 1 },
        '#fff': { r: 255, g: 255, b: 255, a: 1 },
        transparent: { r: 0, g: 0, b: 0, a: 0 }
    }

    function* effectivePlanSteps(C, plans, snapshots, batchSize = 192, targets = plans.keys()) {
        const budget = Math.max(1, Math.floor(batchSize) || 192)
        let processed = 0
        const cache = new Map(), active = new Map(), result = new Map()
        const colors = new Map()
        const paint = value => {
            if (!colors.has(value)) {
                if (colors.size >= 4096) colors.clear()
                colors.set(value, C.parseColor(value) || NAMED[value])
            }
            return colors.get(value)
        }
        const colorProperty = prop => prop === 'color' || prop.endsWith('-color') || COLORS.has(prop)
        function equal(a, b, prop) {
            if (typeof a !== 'string' || typeof b !== 'string' || /currentcolor|var\(/i.test(a) || /currentcolor|var\(/i.test(b)) return false
            if (!colorProperty(prop)) return a.trim() === b.trim()
            const left = paint(a), right = paint(b)
            return !!left && !!right && ['r', 'g', 'b', 'a'].every(channel => left[channel] === right[channel])
        }
        function intended(node, pseudo, prop) {
            if (!cache.has(node)) cache.set(node, new Map())
            const key = pseudo + '|' + prop, values = cache.get(node)
            if (values.has(key)) return values.get(key)
            if (!active.has(node)) active.set(node, new Set())
            if (active.get(node).has(key)) return undefined
            active.get(node).add(key)
            let value = plans.get(node)?.rules[pseudo]?.[prop]
            const record = snapshots.get(node), source = pseudo ? record?.pseudos?.[pseudo] : record?.style
            if (value === undefined && source) {
                value = source[prop]
                const parent = pseudo ? node : record.parent
                if (INHERITED.has(prop) && parent) {
                    const parentBefore = snapshots.get(parent)?.style?.[prop], parentAfter = intended(parent, '', prop)
                    if (!equal(parentBefore, parentAfter, prop) && !equal(value, parentAfter, prop)) value = undefined
                }
            }
            active.get(node).delete(key)
            values.set(key, value)
            return value
        }
        for (const node of targets) {
            const plan = plans.get(node)
            if (!plan) continue
            const record = snapshots.get(node), rules = {}
            for (const [pseudo, props] of Object.entries(plan.rules)) {
                const source = pseudo ? record?.pseudos?.[pseudo] : record?.style
                const retained = {}
                for (const [prop, value] of Object.entries(props)) {
                    let redundant = !!source && equal(value, source[prop], prop)
                    const parent = pseudo ? node : record?.parent
                    if (redundant && INHERITED.has(prop) && parent) redundant = equal(value, intended(parent, '', prop), prop)
                    if (redundant && prop !== 'color' && (colorProperty(prop)
                        || (['box-shadow', 'text-shadow'].includes(prop) && value !== 'none'))) redundant = equal(source.color, intended(node, pseudo, 'color'), 'color')
                    if (!redundant) retained[prop] = value
                }
                if (Object.keys(retained).length) rules[pseudo] = retained
            }
            result.set(node, { ...plan, rules })
            if (++processed % budget === 0) yield { processed }
        }
        return result
    }

    function effectivePlans(C, plans, snapshots, targets) {
        const steps = effectivePlanSteps(C, plans, snapshots, 192, targets)
        let next
        do { next = steps.next() } while (!next.done)
        return next.value
    }

    const api = { effectivePlans, effectivePlanSteps }
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else globalThis.EinkContrastOutput = api
})()

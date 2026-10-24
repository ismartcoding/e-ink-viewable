(() => {
    'use strict'

    function createInlineStyles(doc) {
        const entries = new Map()
        const expected = new Map()
        const normalized = new Map()
        const scratch = doc.createElement('span').style
        const beforeStyle = doc.createElement('span').style
        const afterStyle = doc.createElement('span').style

        function write(el, prop, value, priority) {
            if (el.style.getPropertyValue(prop) === value && el.style.getPropertyPriority(prop) === priority) return
            const before = el.getAttribute('style')
            if (value) el.style.setProperty(prop, value, priority)
            else el.style.removeProperty(prop)
            const after = el.getAttribute('style')
            if (!expected.has(el)) expected.set(el, [])
            expected.get(el).push({ before, after })
        }

        function readMutations(records) {
            const byNode = new Map()
            const own = new Set()
            for (const record of records) if (record.type === 'attributes' && record.attributeName === 'style') {
                if (!byNode.has(record.target)) byNode.set(record.target, [])
                byNode.get(record.target).push(record)
            }
            for (const [el, changes] of byNode) {
                for (let i = 0; i < changes.length; i++) {
                    const record = changes[i]
                    const before = record.oldValue
                    const after = i + 1 < changes.length ? changes[i + 1].oldValue : el.getAttribute('style')
                    const writes = expected.get(el) || []
                    const index = writes.findIndex(item => item.before === before && item.after === after)
                    if (index >= 0) {
                        writes.splice(index, 1)
                        own.add(record)
                    } else if (entries.has(el)) {
                        beforeStyle.cssText = before || ''
                        afterStyle.cssText = after || ''
                        for (const [prop] of entries.get(el)) {
                            const value = afterStyle.getPropertyValue(prop), priority = afterStyle.getPropertyPriority(prop)
                            if (value !== beforeStyle.getPropertyValue(prop) || priority !== beforeStyle.getPropertyPriority(prop)) {
                                entries.get(el).set(prop, { value, priority })
                            }
                        }
                    }
                }
                if (!expected.get(el)?.length) expected.delete(el)
            }
            return own
        }

        function pause(scope) {
            for (const el of scope || entries.keys()) {
                for (const [prop, original] of entries.get(el) || []) write(el, prop, original.value, original.priority)
            }
        }

        function apply(plans, scope) {
            const candidates = scope || new Set([...entries.keys(), ...plans.keys()])
            for (const el of candidates) {
                const plan = plans.get(el), previous = entries.get(el), retained = new Map()
                const properties = el.isConnected && !el.localName.includes('-') ? plan?.rules[''] || {} : {}
                for (const [prop, target] of Object.entries(properties)) {
                    if (el.style.getPropertyPriority(prop) !== 'important') continue
                    const key = prop + ':' + target
                    if (!normalized.has(key)) {
                        scratch.cssText = ''
                        scratch.setProperty(prop, target, 'important')
                        normalized.set(key, scratch.getPropertyValue(prop))
                    }
                    const value = normalized.get(key)
                    const prior = previous?.get(prop)
                    if (!prior && el.style.getPropertyValue(prop) === value) continue
                    retained.set(prop, prior || { value: el.style.getPropertyValue(prop), priority: 'important' })
                    write(el, prop, value, 'important')
                }
                for (const [prop, original] of previous || []) {
                    if (!retained.has(prop)) write(el, prop, original.value, original.priority)
                }
                if (retained.size) entries.set(el, retained)
                else entries.delete(el)
            }
        }

        function remove(el) {
            const props = entries.get(el)
            if (props) for (const [prop, original] of props) write(el, prop, original.value, original.priority)
            entries.delete(el)
            expected.delete(el)
        }

        return { readMutations, pause, apply, remove,
            clear() { pause(); entries.clear(); expected.clear() },
            size: () => entries.size
        }
    }

    const api = { createInlineStyles }
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else globalThis.EinkContrastInline = api
})()

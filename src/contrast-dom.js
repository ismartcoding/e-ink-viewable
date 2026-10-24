(() => {
    'use strict'

    const HOOK = 'data-eink-contrast'
    const SKIP = new Set(['head', 'script', 'style', 'link', 'meta', 'title', 'base', 'noscript', 'template', 'defs', 'filter', 'stop', 'lineargradient', 'radialgradient'])
    const PSEUDOS = ['::before', '::after']
    const NATIVE_STATE = new Set(['input', 'textarea', 'select', 'option', 'button', 'label'])
    const ACTIONS = new Set(['button', 'a', 'summary', 'option', 'input', 'select', 'textarea'])
    const ACTION_ROLES = new Set(['button', 'tab', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'radio', 'checkbox', 'switch', 'treeitem'])
    const MEDIA = new Set(['img', 'video', 'canvas', 'iframe', 'object', 'embed', 'picture'])
    const SNAPSHOT_VALUES = ['tag', 'role', 'shape', 'hasText', 'hasChildren', 'selected', 'disabled', 'focusable', 'editable', 'focus', 'interacted', 'svg', 'unsafe']
    const RECT_VALUES = ['width', 'height', 'left', 'top']
    const Output = typeof module !== 'undefined' && module.exports ? require('./contrast-output.js') : globalThis.EinkContrastOutput

    function declarations(props) {
        return Object.keys(props).sort().map(key => `${key}:${props[key]}!important`).join(';')
    }

    function groupRules(items, previous, allocate) {
        const groups = new Map()
        const members = new Map()
        for (const [node, plan] of items) {
            const tokens = []
            for (const [pseudo, props] of Object.entries(plan.rules || {})) {
                const text = declarations(props)
                if (!text) continue
                const key = pseudo + '|' + text
                if (!groups.has(key)) groups.set(key, { token: previous.get(key) || allocate(), pseudo, props })
                tokens.push(groups.get(key).token)
            }
            members.set(node, tokens)
        }
        return { groups, members }
    }

    function createRuleLayer(root, owned) {
        const doc = root.nodeType === 9 ? root : root.ownerDocument
        const element = doc.createElement('style')
        owned.add(element)
        const rules = new Map()
        const paused = new Set()
        let writes = 0, samplingWrites = 0
        const attach = () => {
            if (element.isConnected) return
            const parent = root.nodeType === 9 ? root.documentElement : root
            parent.appendChild(element)
            for (const [key, value] of rules) {
                const index = element.sheet.insertRule(`${value.selector}{${paused.has(key) ? '' : value.text}}`, element.sheet.cssRules.length)
                value.rule = element.sheet.cssRules[index]
            }
        }
        attach()
        function set(key, selector, props) {
            attach()
            const text = declarations(props)
            const prev = rules.get(key)
            if (!text) {
                if (prev) {
                    const index = Array.from(element.sheet.cssRules).indexOf(prev.rule)
                    if (index >= 0) element.sheet.deleteRule(index)
                    rules.delete(key)
                    paused.delete(key)
                    writes++
                }
                return
            }
            if (prev && prev.text === text && prev.selector === selector) return
            if (prev) {
                if (prev.selector !== selector) prev.rule.selectorText = selector
                if (!paused.has(key)) prev.rule.style.cssText = text
                Object.assign(prev, { text, selector })
            } else {
                const sheet = element.sheet
                const index = sheet.insertRule(`${selector}{${text}}`, sheet.cssRules.length)
                rules.set(key, { rule: sheet.cssRules[index], text, selector })
            }
            writes++
        }
        return {
            set, attach,
            pause(keys) {
                attach()
                for (const key of keys) {
                    const value = rules.get(key)
                    if (!value || paused.has(key)) continue
                    paused.add(key)
                    if (value.rule.style.cssText) { value.rule.style.cssText = ''; samplingWrites++ }
                }
            },
            resume() {
                if (!paused.size) return
                attach()
                for (const key of paused) {
                    const value = rules.get(key)
                    if (value) { value.rule.style.cssText = value.text; samplingWrites++ }
                }
                paused.clear()
            },
            disable(value) {
                attach()
                if (element.sheet.disabled !== value) element.sheet.disabled = value
            },
            retain(keys) {
                const removed = [...rules].filter(([key]) => !keys.has(key))
                if (!removed.length) return
                attach()
                const indexes = new Map(Array.from(element.sheet.cssRules, (rule, index) => [rule, index]))
                removed.sort((a, b) => indexes.get(b[1].rule) - indexes.get(a[1].rule))
                for (const [key, value] of removed) {
                    const index = indexes.get(value.rule)
                    if (index !== undefined) element.sheet.deleteRule(index)
                    rules.delete(key)
                    paused.delete(key)
                    writes++
                }
            },
            remove() { rules.clear(); paused.clear(); element.remove() },
            stats: () => ({ rules: rules.size, writes, samplingWrites })
        }
    }

    function createContrastEngine(C, Policy, options = {}) {
        const schedule = options.schedule || (fn => requestAnimationFrame(fn))
        const batchSize = options.batchSize || 192
        const planner = Policy.createPlanner(C)
        const snapshots = new Map()
        const nodes = new Set()
        const roots = new Map()
        const ids = new Map()
        const originalHooks = new Map()
        const hookValues = new Map()
        const tokens = new Map()
        const owned = new WeakSet()
        const urgent = new Set()
        const background = new Set()
        const guardQueue = new Set()
        const guardRecords = new Map()
        const removedCandidates = new Set()
        const pendingChanges = new Set()
        const elementRoots = new Map()
        const hookRepairs = new Set()
        const nativeStates = new Map()
        const dependencyChildren = new Map()
        const labelsByControl = new Map()
        const structuralChanges = new Set()
        const inheritedChanges = new Set()
        const interacted = new WeakSet()
        const cleanups = []
        const source = options.styles || ((el, pseudo) => el.ownerDocument.defaultView.getComputedStyle(el, pseudo))
        let documentRoot, view, active = false, scheduled = false, timer, counter = 0, tokenCounter = 0, generation = 0
        let transactions = 0, failures = 0, lastError = null, totalMs = 0, maxMs = 0, guardPasses = 0, guardPlans = 0
        let guardCycle = false, reconcileCursor, inspectionCursor
        let reconcileDelay = 1, reconcileWait = 0, stableRotations = 0, reconcileChanged = false
        let inline, lastPlans = new Map(), rawPlans = new Map(), planning, initial = true, paintStarted = false
        let propertyNames = []

        function selector(token, pseudo = '') {
            return `:is(*,#eink):is(*,#eink):is(*,#eink)[${HOOK}~="${token}"]${pseudo}`
        }

        function setTokens(el, kind, values) {
            if (!tokens.has(el)) tokens.set(el, { paint: [], guard: [] })
            const entry = tokens.get(el)
            if (!hookRepairs.has(el) && entry[kind].join(' ') === values.join(' ')) return
            hookRepairs.delete(el)
            entry[kind] = values
            const valuesToApply = [...entry.guard, ...entry.paint]
            const value = valuesToApply.length ? ['n' + ids.get(el), ...valuesToApply].join(' ') : originalHooks.get(el)
            hookValues.set(el, value)
            if (el.getAttribute(HOOK) !== value) {
                if (value === null) el.removeAttribute(HOOK)
                else el.setAttribute(HOOK, value)
                return 1
            }
        }

        function eligible(el) {
            return el && el.nodeType === 1 && !owned.has(el) && !SKIP.has(el.localName)
                && !(el.namespaceURI === 'http://www.w3.org/2000/svg' && !['svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use'].includes(el.localName))
        }

        function identify(el) {
            if (ids.has(el)) return
            counter++
            originalHooks.set(el, el.getAttribute(HOOK))
            ids.set(el, String(counter))
            hookValues.set(el, originalHooks.get(el))
        }

        function listen(target, name, handler, capture = true, disposers = cleanups) {
            target.addEventListener(name, handler, capture)
            disposers.push(() => target.removeEventListener(name, handler, capture))
        }

        function observe(root) {
            if (roots.has(root)) return
            const output = createRuleLayer(root, owned)
            const guard = createRuleLayer(root, owned)
            const base = createRuleLayer(root, owned)
            for (const [selector, props] of Object.entries(Policy.BASE_RULES)) base.set(selector, selector, props)
            const handleMutations = mutations => {
                const own = inline.readMutations(mutations)
                let changed = false
                for (const m of mutations) {
                    if (own.has(m) || owned.has(m.target)) continue
                    if (m.type === 'attributes' && m.attributeName === HOOK) {
                        if (m.target.getAttribute(HOOK) !== hookValues.get(m.target)) { hookRepairs.add(m.target); queue(m.target); kick() }
                        continue
                    }
                    const added = Array.from(m.addedNodes || []).filter(n => !owned.has(n))
                    const removed = Array.from(m.removedNodes || []).filter(n => !owned.has(n))
                    if (m.type === 'childList' && !added.length && !removed.length) continue
                    const stylesheet = node => node && ['style', 'link'].includes(node.localName)
                    if (initial && (stylesheet(m.target) || stylesheet(m.target.parentElement)
                        || [...added, ...removed].some(node => stylesheet(node)
                            || Array.from(node.querySelectorAll?.('style,link') || []).some(stylesheet)))) {
                        planner.reset()
                        sweep()
                    }
                    for (const node of added) discover(node)
                    for (const node of removed) {
                        const pending = [node]
                        while (pending.length) {
                            const el = pending.pop()
                            if (nodes.has(el)) removedCandidates.add(el)
                            for (const child of el.children || []) pending.push(child)
                            for (const child of el.shadowRoot?.children || []) pending.push(child)
                        }
                    }
                    if (m.type === 'attributes' && ['class', 'style'].includes(m.attributeName)
                        && (m.target === documentRoot.documentElement || m.target === documentRoot.body)) planner.reset()
                    if (m.type === 'childList') {
                        if (nodes.has(m.target)) structuralChanges.add(m.target)
                        queue(m.target)
                        for (const node of added) invalidate(node)
                    } else invalidate(m.target)
                    changed = true
                }
                if (changed) kick()
            }
            const observer = new view.MutationObserver(handleMutations)
            observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true })
            const disposers = []
            roots.set(root, { output, guard, base, observer, disposers, handleMutations, paintTokens: new Map(), paintGroups: new Map(), paintMembers: new Map(), guardTokens: new Map() })
            listen(root, 'slotchange', event => invalidate(event.target), true, disposers)
            const onEvent = event => {
                const path = event.composedPath ? event.composedPath() : [event.target]
                const target = path.find(eligible)
                if (event.type === 'click' && target) interacted.add(target)
                invalidate(target)
                if (target?.localName === 'input') {
                    const name = target.name || target.getAttribute('name')
                    const root = elementRoots.get(target) || target.getRootNode()
                    const peers = target.type === 'radio' && name
                        ? (root.getElementsByName ? root.getElementsByName(name) : root.querySelectorAll('input[type="radio"]')) : [target]
                    for (const peer of new Set([target, ...peers])) if (peer === target || (peer.type === 'radio' && peer.form === target.form && (peer.name || peer.getAttribute('name')) === name)) {
                        if (peer !== target) invalidate(peer)
                        for (const label of peer.labels || []) invalidate(label)
                    }
                }
            }
            for (const name of ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'focusout', 'input', 'change', 'click', 'transitionend', 'transitioncancel', 'animationend', 'animationcancel']) listen(root, name, onEvent, true, disposers)
            listen(root, 'load', event => { if (event.target.localName === 'link') { planner.reset(); sweep() } }, true, disposers)
        }

        function discover(root) {
            if (!root || owned.has(root)) return
            if (root.nodeType === 9 || root.nodeType === 11) observe(root)
            const list = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : Array.from(root.querySelectorAll ? root.querySelectorAll('*') : [])
            for (const el of list) {
                if (!eligible(el)) continue
                if (elementRoots.has(el) && elementRoots.get(el) !== el.getRootNode()) clearPaint(el)
                elementRoots.set(el, el.getRootNode())
                if (nodes.has(el) && el.getAttribute(HOOK) !== hookValues.get(el)) {
                    originalHooks.set(el, el.getAttribute(HOOK))
                    const value = hookValues.get(el)
                    if (value === null) el.removeAttribute(HOOK)
                    else el.setAttribute(HOOK, value)
                }
                if (!nodes.has(el)) {
                    identify(el)
                    nodes.add(el)
                    background.add(el)
                    guardQueue.add(el)
                }
                if (el.shadowRoot) discover(el.shadowRoot)
            }
        }

        function queue(el) {
            if (!eligible(el) || !el.isConnected) return
            if (!nodes.has(el)) discover(el)
            urgent.add(el)
            guardQueue.add(el)
        }

        function wakeReconciliation() {
            reconcileDelay = 1
            reconcileWait = 0
            stableRotations = 0
            reconcileChanged = true
        }

        function action(record) {
            return record && (record.focusable || record.selected || ACTIONS.has(record.tag) || ACTION_ROLES.has(record.role)
                || record.style.cursor === 'pointer' || !!record.control)
        }

        function actionPeers(el) {
            const record = snapshots.get(el)
            if (!action(record)) return []
            const peers = Array.from(dependencyChildren.get(record.parent) || [], node => snapshots.get(node)).filter(action)
            return Policy.groupCompatible(peers) ? peers.map(record => record.node) : []
        }

        function keepDependency(next, prev) {
            if (prev) {
                const siblings = dependencyChildren.get(prev.parent)
                if (siblings) {
                    siblings.delete(prev.node)
                    if (!siblings.size) dependencyChildren.delete(prev.parent)
                }
                if (prev.control) {
                    const labels = labelsByControl.get(prev.control)
                    labels?.delete(prev.node)
                    if (!labels?.size) labelsByControl.delete(prev.control)
                }
            }
            if (next?.control) {
                if (!labelsByControl.has(next.control)) labelsByControl.set(next.control, new Set())
                labelsByControl.get(next.control).add(next.node)
            }
            if (!next || !(action(next) || MEDIA.has(next.tag) || next.unsafe || /url\(/i.test(next.style['background-image'] || '')
                || (next.hasText && ['absolute', 'fixed'].includes(next.style.position)))) return
            if (!dependencyChildren.has(next.parent)) dependencyChildren.set(next.parent, new Set())
            dependencyChildren.get(next.parent).add(next.node)
        }

        function invalidate(target) {
            if (!active) return
            wakeReconciliation()
            let el = target && target.nodeType === 3 ? target.parentElement : target
            if (el && el.nodeType === 1) {
                structuralChanges.delete(el)
                const parent = el.assignedSlot || el.parentElement || el.getRootNode().host
                queue(el)
                for (const descendant of el.querySelectorAll('*')) queue(descendant)
                if (parent) {
                    queue(parent)
                    for (const child of actionPeers(el)) {
                        queue(child)
                        for (const descendant of child.querySelectorAll('*')) queue(descendant)
                    }
                }
                for (let i = 0; el && i < 32; i++, el = el.assignedSlot || el.parentElement || el.getRootNode().host) queue(el)
                const original = target && target.nodeType === 3 ? target.parentElement : target
                for (const label of labelsByControl.get(original) || []) invalidate(label)
            }
            kick()
        }

        function sweep() {
            if (!active) return
            wakeReconciliation()
            for (const el of nodes) { background.add(el); guardQueue.add(el) }
            kick()
        }

        function kick() {
            if (!scheduled && active && !documentRoot.hidden) {
                scheduled = true
                const current = generation
                schedule(() => { if (current === generation) drain() })
            }
        }

        function copy(style) {
            const values = {}
            for (const prop of Policy.SOURCE) values[prop] = style.getPropertyValue(prop)
            return values
        }

        function sameSource(left, right) {
            for (const prop of Policy.SOURCE) if (left[prop] !== right[prop]) return false
            return true
        }

        function samePseudos(left, right) {
            const names = Object.keys(left)
            if (names.length !== Object.keys(right).length) return false
            for (const name of names) if (!right[name] || !sameSource(left[name], right[name])) return false
            return true
        }

        function sameSnapshot(left, right) {
            for (const prop of SNAPSHOT_VALUES) if (left[prop] !== right[prop]) return false
            for (const prop of RECT_VALUES) if (left.rect[prop] !== right.rect[prop]) return false
            return sameSource(left.style, right.style) && samePseudos(left.pseudos, right.pseudos)
        }

        function nativeState(el) {
            if (!NATIVE_STATE.has(el.localName)) return null
            return [el.checked, el.indeterminate, el.selected, el.disabled, el.localName === 'label' ? el.control?.checked : undefined].join(':')
        }

        function hasText(el) {
            if (!documentRoot.createTreeWalker) return /\S/.test(el.textContent || '')
            const first = el.firstChild
            if (first?.nodeType === 3 && /\S/.test(first.nodeValue || '')) return true
            const walker = documentRoot.createTreeWalker(el, 4)
            let node
            while ((node = walker.nextNode())) if (/\S/.test(node.nodeValue || '')) return true
            return false
        }

        function snapshot(el, samples) {
            const cs = samples?.[''] || source(el)
            const style = copy(cs)
            const pseudos = {}
            if (!['img', 'video', 'canvas', 'iframe', 'input', 'textarea', 'select', 'object', 'embed'].includes(el.localName) && el.namespaceURI !== 'http://www.w3.org/2000/svg') {
                for (const name of PSEUDOS) {
                    const p = samples?.[name] || source(el, name)
                    if (p.content !== 'none' && p.content !== 'normal') pseudos[name] = copy(p)
                }
            }
            if (el.localName === 'input' || el.localName === 'textarea') pseudos['::placeholder'] = copy(source(el, '::placeholder'))
            const rect = el.getBoundingClientRect()
            const childNames = []
            for (let i = 0; i < Math.min(el.children.length, 8); i++) childNames.push(el.children[i].localName)
            const role = el.getAttribute('role') || ''
            const control = el.localName === 'label' ? el.control || null : null
            const state = name => el.getAttribute(name)
            const selected = ['aria-selected', 'aria-pressed', 'aria-checked'].some(name => state(name) === 'true')
                || (el.checked === true && !['checkbox', 'radio'].includes(el.type)) || el.selected === true
                || (control && control.checked === true)
            const blocked = (el.localName.includes('-') && Policy.PAINT.some(prop => el.style.getPropertyPriority(prop) === 'important'))
                || (el.style.getPropertyPriority('transition-property') === 'important' && cs.transitionDuration.split(',').some(s => parseFloat(s) > 0))
            return {
                node: el, parent: el.assignedSlot || el.parentElement || el.getRootNode().host || null, control,
                tag: el.localName, role, style, pseudos,
                rect: { width: rect.width, height: rect.height, left: rect.left, top: rect.top },
                shape: el.localName + ':' + childNames.join(','),
                hasText: hasText(el), hasChildren: el.childElementCount > 0,
                selected, disabled: el.disabled === true || state('aria-disabled') === 'true',
                focusable: el.tabIndex >= 0, editable: el.isContentEditable,
                focus: el.matches(':focus-visible'), transient: el.matches(':hover,:active'),
                interacted: interacted.has(el), svg: el.namespaceURI === 'http://www.w3.org/2000/svg',
                svgRoot: el.ownerSVGElement || (el.localName === 'svg' ? el : null),
                unsafe: blocked
            }
        }

        function storeSnapshot(el, next, batch) {
            const state = nativeState(el)
            if (state !== null) nativeStates.set(el, state)
            const prev = snapshots.get(el)
            if (!prev || !sameSnapshot(prev, next) || prev.parent !== next.parent) {
                pendingChanges.add(el)
                wakeReconciliation()
                if (prev && (Policy.SOURCE.some(prop => prop !== 'width' && prop !== 'height' && prev.style[prop] !== next.style[prop])
                    || !samePseudos(prev.pseudos, next.pseudos)
                    || ['selected', 'focus', 'unsafe', 'disabled', 'editable'].some(prop => prev[prop] !== next[prop]))) {
                    inheritedChanges.add(el)
                    if (structuralChanges.has(el)) for (const descendant of el.querySelectorAll('*')) if (!batch.has(descendant)) queue(descendant)
                }
            }
            if (prev && ['html', 'body'].includes(next.tag) && ['background-color', 'color'].some(prop => prev.style[prop] !== next.style[prop])) planner.reset()
            keepDependency(next, prev)
            snapshots.set(el, next)
        }

        function prepareGuards(batch) {
            const guardedRoots = new Set(), suspendedGuards = []
            for (const el of batch) if (guardRecords.has(el)) guardedRoots.add(elementRoots.get(el))
            for (const [root, { guard, base }] of roots) {
                base.attach()
                if (guardedRoots.has(root)) { guard.disable(true); suspendedGuards.push(guard) }
            }
            const texts = new WeakMap()
            let compile, combined = false, hookWrites = 0
            try {
                for (const el of batch) {
                    if (!el.isConnected) continue
                    const root = el.getRootNode(), layer = roots.get(root)
                    if (!layer) continue
                    const members = []
                    const entries = new Map()
                    const samples = initial && !paintStarted ? {} : null
                    const list = el.namespaceURI === 'http://www.w3.org/2000/svg' || ['img', 'video', 'canvas', 'iframe', 'object', 'embed', 'input', 'textarea', 'select'].includes(el.localName) ? [''] : ['', ...PSEUDOS]
                    for (const pseudo of list) {
                        const cs = source(el, pseudo || undefined)
                        if (samples) samples[pseudo] = cs
                        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue
                        const transition = { property: cs.transitionProperty, duration: cs.transitionDuration,
                            delay: cs.transitionDelay, timing: cs.transitionTimingFunction, behavior: cs.transitionBehavior }
                        if (![transition.duration, transition.delay].some(value => value.split(',').some(s => parseFloat(s) > 0))) continue
                        if (!propertyNames.length) propertyNames = Array.from(cs).filter(prop => !prop.startsWith('--'))
                        let tail = Array.from({ length: Math.max(0, cs.length - propertyNames.length) }, (_, i) => cs[i + propertyNames.length])
                        if (tail.some(prop => !prop.startsWith('--'))) tail = Array.from(cs).filter(prop => prop.startsWith('--'))
                        if (!compile) compile = Policy.createTransitionCache(propertyNames, (value, properties) => { guardPlans++; return Policy.transitionPlan(value, properties) })
                        const plan = compile(transition, tail)
                        if (!plan) continue
                        if (!texts.has(plan)) texts.set(plan, declarations(plan))
                        const key = pseudo + '|' + texts.get(plan)
                        if (!layer.guardTokens.has(key)) layer.guardTokens.set(key, 't' + (++tokenCounter))
                        const token = layer.guardTokens.get(key)
                        entries.set(key, { token, pseudo, plan })
                        members.push(token)
                    }
                    if (entries.size) guardRecords.set(el, entries)
                    else guardRecords.delete(el)
                    hookWrites += setTokens(el, 'guard', members) || 0
                    if (samples && !entries.size) {
                        if (!combined) { transactions++; combined = true }
                        storeSnapshot(el, snapshot(el, samples), batch)
                        urgent.delete(el)
                        background.delete(el)
                    }
                }
                const groups = new Map([...roots.keys()].map(root => [root, new Map()]))
                for (const [el, entries] of guardRecords) {
                    const group = groups.get(el.getRootNode())
                    if (group) for (const [key, entry] of entries) group.set(key, entry)
                }
                for (const [root, layer] of roots) {
                    const keys = new Set()
                    layer.guardTokens.clear()
                    for (const [key, { token, pseudo, plan }] of groups.get(root)) {
                        keys.add(token)
                        layer.guardTokens.set(key, token)
                        layer.guard.set(token, selector(token, pseudo), plan)
                    }
                    layer.guard.retain(keys)
                }
            } finally {
                for (const guard of suspendedGuards) guard.disable(false)
            }
            return hookWrites
        }

        function prune() {
            let removed = false
            for (const el of removedCandidates) {
                if (el.isConnected) continue
                removed = true
                clearPaint(el)
                inline.remove(el)
                restoreHook(el)
                nodes.delete(el)
                keepDependency(null, snapshots.get(el))
                snapshots.delete(el)
                urgent.delete(el)
                background.delete(el)
                guardQueue.delete(el)
                guardRecords.delete(el)
                ids.delete(el)
                tokens.delete(el)
                hookValues.delete(el)
                rawPlans.delete(el)
                lastPlans.delete(el)
                elementRoots.delete(el)
                hookRepairs.delete(el)
                nativeStates.delete(el)
                dependencyChildren.delete(el)
                labelsByControl.delete(el)
                structuralChanges.delete(el)
                inheritedChanges.delete(el)
            }
            removedCandidates.clear()
            for (const [root, value] of roots) {
                if (root.nodeType !== 9 && !root.host.isConnected) {
                    value.observer.disconnect()
                    for (const dispose of value.disposers) dispose()
                    value.output.remove()
                    value.guard.remove()
                    value.base.remove()
                    roots.delete(root)
                }
            }
            return removed
        }

        function restoreHook(el) {
            const value = originalHooks.get(el)
            if (value === undefined) return
            if (el.getAttribute(HOOK) === hookValues.get(el)) {
                if (value === null) el.removeAttribute(HOOK)
                else el.setAttribute(HOOK, value)
            }
            originalHooks.delete(el)
        }

        function clearPaint(el) {
            const layer = roots.get(elementRoots.get(el))
            if (!layer) return
            for (const key of layer.paintMembers.get(el) || []) layer.paintGroups.get(key)?.members.delete(el)
            layer.paintMembers.delete(el)
        }

        function* renderSteps(plans, affected) {
            paintStarted = true
            let batch = new Set()
            for (const el of affected) {
                const layer = roots.get(elementRoots.get(el))
                if (!layer) continue
                if (!plans.has(el) && !layer.paintMembers.has(el)) continue
                clearPaint(el)
                const keys = [], values = []
                for (const [pseudo, props] of Object.entries(plans.get(el)?.rules || {})) {
                    const text = declarations(props)
                    if (!text) continue
                    const cohort = Math.floor((Number(ids.get(el)) - 1) / batchSize)
                    const key = pseudo + '|' + text + '|' + cohort
                    if (!layer.paintGroups.has(key)) layer.paintGroups.set(key, { token: 'p' + (++tokenCounter), pseudo, props, members: new Set() })
                    const group = layer.paintGroups.get(key)
                    layer.output.set(group.token, selector(group.token, pseudo), props)
                    group.members.add(el)
                    keys.push(key)
                    values.push(group.token)
                }
                if (keys.length) layer.paintMembers.set(el, keys)
                setTokens(el, 'paint', values)
                batch.add(el)
                if (batch.size >= batchSize) { inline.apply(plans, batch); batch = new Set(); yield }
            }
            if (batch.size) inline.apply(plans, batch)
            for (const [root, layer] of roots) {
                const keys = new Set()
                layer.base.attach()
                layer.paintTokens.clear()
                for (const [key, { token, pseudo, props, members }] of layer.paintGroups) {
                    if (!members.size) { layer.paintGroups.delete(key); continue }
                    keys.add(token)
                    layer.paintTokens.set(key, token)
                    layer.output.set(token, selector(token, pseudo), props)
                }
                layer.output.retain(keys)
            }
        }

        function beginPlanning() {
            const affected = new Set()
            const expanded = new Set()
            const addTree = el => {
                const pending = [el]
                while (pending.length) {
                    const current = pending.pop()
                    if (!snapshots.has(current) || expanded.has(current)) continue
                    expanded.add(current)
                    affected.add(current)
                    const children = [...(current.children || []), ...(current.shadowRoot?.children || [])]
                    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i])
                }
            }
            if (initial) for (const el of snapshots.keys()) affected.add(el)
            else for (const el of pendingChanges) {
                const record = snapshots.get(el)
                if (!record) continue
                if (record.svgRoot) { addTree(record.svgRoot); continue }
                if (!inheritedChanges.has(el)) {
                    affected.add(el)
                    if (structuralChanges.has(el)) for (const child of dependencyChildren.get(el) || []) if (action(snapshots.get(child))) addTree(child)
                } else addTree(el)
                for (const sibling of actionPeers(el)) addTree(sibling)
            }
            const context = new Set(affected)
            for (const el of affected) for (let parent = snapshots.get(el)?.parent; parent; parent = snapshots.get(parent)?.parent) {
                if (context.has(parent)) break
                context.add(parent)
                const siblings = Array.from(dependencyChildren.get(parent) || [], child => snapshots.get(child)).filter(Boolean)
                const grouped = Policy.groupCompatible(siblings.filter(r => action(r) && r.style.display !== 'none' && r.style.visibility !== 'hidden'))
                const hasImage = siblings.some(r => MEDIA.has(r.tag) || /url\(/i.test(r.style['background-image'] || ''))
                for (const sibling of siblings) if ((grouped && action(sibling)) || MEDIA.has(sibling.tag) || sibling.unsafe || /url\(/i.test(sibling.style['background-image'] || '')
                    || (hasImage && sibling.hasText && ['absolute', 'fixed'].includes(sibling.style.position))) context.add(sibling.node)
            }
            const records = [...context].map(el => snapshots.get(el)).filter(Boolean)
            planning = { affected, stage: 'plan', iterator: planner.planSteps(records, { width: view.innerWidth, height: view.innerHeight }, batchSize) }
        }

        function advancePlanning() {
            const started = view.performance.now()
            for (let steps = 0; planning && steps < 32; steps++) {
                const next = planning.iterator.next()
                if (next.done) {
                    if (planning.stage === 'plan') {
                        const updates = new Map()
                        for (const el of planning.affected) {
                            const plan = next.value.get(el)
                            if (plan) updates.set(el, plan)
                        }
                        planning.updates = updates
                        planning.stage = 'output'
                        planning.iterator = Output.effectivePlanSteps(C, {
                            get: el => updates.has(el) ? updates.get(el) : rawPlans.get(el)
                        }, snapshots, batchSize, planning.affected)
                    } else {
                        if (planning.stage === 'render') {
                            pendingChanges.clear()
                            structuralChanges.clear()
                            inheritedChanges.clear()
                            initial = false
                            planning = undefined
                            continue
                        }
                        for (const [el, plan] of next.value) {
                            if (Object.keys(plan.rules).length) lastPlans.set(el, plan)
                            else lastPlans.delete(el)
                        }
                        for (const [el, plan] of planning.updates) rawPlans.set(el, plan)
                        planning.stage = 'render'
                        planning.iterator = renderSteps(lastPlans, planning.affected)
                    }
                }
                if (planning?.stage === 'render') break
                if (view.performance.now() - started >= 8) break
            }
            if (planning) kick()
        }

        function drain() {
            const started = view.performance.now()
            try { drainWork() }
            catch (error) {
                failures++
                lastError = error.message
                planning = undefined
                if (options.onError) options.onError(error)
                else view.console.warn('E-ink contrast conversion failed:', error)
            } finally {
                const elapsed = view.performance.now() - started
                totalMs += elapsed
                maxMs = Math.max(maxMs, elapsed)
            }
        }

        function drainWork() {
            scheduled = false
            if (!active || documentRoot.hidden) return
            for (const { observer, handleMutations } of roots.values()) handleMutations(observer.takeRecords())
            const removed = prune()
            if (planning) {
                if (urgent.size || background.size || guardQueue.size || removed) planning = undefined
                else { advancePlanning(); return }
            }
            if (guardQueue.size) {
                if (!guardCycle) { guardPasses++; guardCycle = true }
                const started = view.performance.now()
                let batches = 0
                while (guardQueue.size) {
                    const guards = new Set()
                    for (const el of guardQueue) {
                        guardQueue.delete(el)
                        if (el.isConnected) guards.add(el)
                        if (guards.size >= batchSize) break
                    }
                    const hooks = prepareGuards(guards)
                    batches++
                    if (!initial || paintStarted || hooks || batches >= 2 || (view.performance.now() - started) * 2 >= 8) break
                }
                if (guardQueue.size) { kick(); return }
                guardCycle = false
                if (batches > 1 || view.performance.now() - started >= 8) { kick(); return }
            }
            const batch = new Set()
            const readLimit = initial ? batchSize : Math.min(batchSize, 64)
            const take = (queue, limit) => {
                for (const el of queue) {
                    if (batch.size >= limit) break
                    queue.delete(el)
                    urgent.delete(el)
                    background.delete(el)
                    if (el.isConnected) batch.add(el)
                }
            }
            take(urgent, Math.ceil(readLimit * 0.75))
            take(background, readLimit)
            take(urgent, readLimit)
            if (!batch.size && !removed) {
                if (pendingChanges.size) { beginPlanning(); advancePlanning() }
                return
            }
            for (const el of batch) {
                const parent = el.assignedSlot || el.parentElement || el.getRootNode().host
                if (parent && nodes.has(parent) && !snapshots.has(parent)) batch.add(parent)
            }
            let suspended = false
            const sourceScope = new Set(batch)
            for (const el of batch) for (let parent = el.parentElement || el.getRootNode().host; parent; parent = parent.parentElement || parent.getRootNode().host) {
                if (sourceScope.has(parent)) break
                sourceScope.add(parent)
            }
            try {
                const sampling = new Map([...roots.values()].map(layer => [layer, new Set()]))
                for (const el of sourceScope) {
                    const layer = roots.get(elementRoots.get(el))
                    if (layer) for (const key of layer.paintMembers.get(el) || []) sampling.get(layer).add(layer.paintGroups.get(key).token)
                }
                for (const [layer, keys] of sampling) layer.output.pause(keys)
                suspended = true
                inline.pause(sourceScope)
                transactions++
                for (const el of batch) {
                    storeSnapshot(el, snapshot(el), batch)
                }
                lastError = null
            } catch (error) {
                failures++
                lastError = error.message
                if (options.onError) options.onError(error)
                else view.console.warn('E-ink contrast conversion failed:', error)
            } finally {
                if (suspended) {
                    try { inline.apply(lastPlans, sourceScope) }
                    finally { for (const { output } of roots.values()) output.resume() }
                }
            }
            if (urgent.size || background.size) kick()
            else if (pendingChanges.size) { beginPlanning(); kick() }
        }

        function start(doc) {
            if (active) return
            documentRoot = doc
            view = doc.defaultView
            inline = globalThis.EinkContrastInline ? globalThis.EinkContrastInline.createInlineStyles(doc) : options.createInlineStyles(doc)
            active = true
            generation++
            discover(doc)
            listen(view, 'resize', () => { planner.reset(); sweep() })
            listen(view, 'pageshow', () => { discover(doc); sweep() })
            listen(doc, 'visibilitychange', () => { if (!doc.hidden) sweep() })
            listen(view, 'pagehide', event => { if (!event.persisted) stop() })
            timer = (options.repeat || view.setInterval.bind(view))(() => {
                if (doc.hidden) return
                if (!background.size && !urgent.size && !guardQueue.size && !scheduled && !planning) {
                    for (const { output, guard, base } of roots.values()) { output.attach(); guard.attach(); base.attach() }
                    let inspected = 0
                    inspectionCursor ||= nodes.values()
                    while (inspected < batchSize) {
                        let next = inspectionCursor.next()
                        if (next.done) {
                            inspectionCursor = nodes.values()
                            if (inspected) break
                            next = inspectionCursor.next()
                            if (next.done) break
                        }
                        const el = next.value
                        inspected++
                        if (!el.isConnected) continue
                        if (el.shadowRoot && !roots.has(el.shadowRoot)) discover(el.shadowRoot)
                        const state = nativeState(el)
                        if (state !== null && nativeStates.has(el) && nativeStates.get(el) !== state) {
                            nativeStates.set(el, state)
                            invalidate(el)
                        }
                    }
                }
                if (!background.size && !urgent.size && !guardQueue.size && !scheduled && !planning) {
                    if (reconcileWait) { reconcileWait--; return }
                    let count = 0
                    reconcileCursor ||= nodes.values()
                    while (count < batchSize) {
                        let next = reconcileCursor.next()
                        if (next.done) {
                            reconcileCursor = nodes.values()
                            if (reconcileChanged) stableRotations = 0
                            else stableRotations++
                            reconcileDelay = stableRotations >= 2 ? 2 : 1
                            reconcileChanged = false
                            if (count) break
                            next = reconcileCursor.next()
                            if (next.done) break
                        }
                        const el = next.value
                        if (!el.isConnected) continue
                        background.add(el)
                        guardQueue.add(el)
                        count++
                    }
                    reconcileWait = reconcileDelay - 1
                }
                kick()
            }, options.recheckInterval || 1000)
            kick()
        }

        function stop() {
            if (!active) return
            for (const { observer, handleMutations } of roots.values()) handleMutations(observer.takeRecords())
            active = false
            generation++
            scheduled = false
            const cancelRepeat = options.cancelRepeat || view.clearInterval.bind(view)
            cancelRepeat(timer)
            for (const dispose of cleanups.splice(0)) dispose()
            for (const value of roots.values()) {
                value.observer.disconnect()
                for (const dispose of value.disposers) dispose()
                value.output.remove()
                value.base.remove()
            }
            inline.clear()
            for (const el of nodes) if (el.isConnected) {
                source(el).color
            }
            for (const value of roots.values()) value.guard.remove()
            for (const el of nodes) restoreHook(el)
            roots.clear(); nodes.clear(); snapshots.clear(); urgent.clear(); background.clear(); guardQueue.clear(); guardRecords.clear(); ids.clear(); tokens.clear(); hookValues.clear(); removedCandidates.clear(); pendingChanges.clear(); elementRoots.clear(); hookRepairs.clear(); nativeStates.clear(); dependencyChildren.clear(); labelsByControl.clear(); structuralChanges.clear(); inheritedChanges.clear()
            reconcileCursor = undefined
            inspectionCursor = undefined
            reconcileDelay = 1
            reconcileWait = 0
            stableRotations = 0
            reconcileChanged = false
            guardCycle = false
            planner.reset()
            lastPlans = new Map()
            rawPlans = new Map()
            planning = undefined
            initial = true
            paintStarted = false
        }

        return { start, invalidate, stop,
            stats() {
                const totals = [...roots.values()].flatMap(r => [r.output.stats(), r.guard.stats(), r.base.stats()])
                return { nodes: nodes.size, roots: roots.size, rules: totals.reduce((n, s) => n + s.rules, 0),
                    writes: totals.reduce((n, s) => n + s.writes, 0), samplingWrites: totals.reduce((n, s) => n + s.samplingWrites, 0), inline: inline ? inline.size() : 0, transactions, failures, lastError, totalMs, maxMs, guardPasses, guardPlans,
                    pending: new Set([...urgent, ...background, ...guardQueue]).size + Number(!!planning || pendingChanges.size > 0 || scheduled) }
            }
        }
    }

    const api = { createContrastEngine, createRuleLayer, groupRules, declarations, HOOK }
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else globalThis.EinkContrastDom = api
})()

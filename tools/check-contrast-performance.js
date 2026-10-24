const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const initialHashes = { source: treeHash(path.join(root, 'src')), tests: treeHash(path.join(root, 'tests')) }
const C = require('../src/color')
const Policy = require('../src/high-contrast/contrast')
const Dom = require('../src/high-contrast/contrast-dom')
const Inline = require('../src/high-contrast/contrast-inline')
const { createDocument } = require('../tests/helpers/contrast-document')

const keys = ['styleReads', 'mainStyleReads', 'pseudoStyleReads', 'rectReads', 'queryCalls', 'queryNodeResults',
    'hookWrites', 'inlineWrites', 'inlinePriorityReads', 'cssomRuleWrites', 'samplingCssomRuleWrites', 'otherCssomRuleWrites',
    'sheetToggles', 'persistentPlanWrites', 'samplingPlanWrites', 'plannerCalls', 'plannerRecords', 'plannerStepCalls']
const empty = () => Object.fromEntries(keys.map(key => [key, 0]))
const difference = (after, before) => Object.fromEntries(keys.map(key => [key, after[key] - before[key]]))
const black = 'rgb(0, 0, 0)', white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
const color = value => C.parseColor(value === '#000' ? black : value === '#fff' ? white : value)
const sameColor = (left, right) => JSON.stringify(color(left)) === JSON.stringify(color(right))

function treeHash(directory) {
    const digest = crypto.createHash('sha256')
    let files = 0
    function visit(relative) {
        for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
            const child = path.join(relative, name), absolute = path.join(directory, child)
            if (fs.statSync(absolute).isDirectory()) visit(child)
            else {
                digest.update(child.split(path.sep).join('/'))
                digest.update('\0')
                digest.update(fs.readFileSync(absolute))
                digest.update('\0')
                files++
            }
        }
    }
    visit('')
    return { algorithm: 'sha256', hash: digest.digest('hex'), files }
}

function measure(contentCount, gray = false, article = false) {
    const f = createDocument({ batchSize: 192 })
    const nav = f.element('nav', f.doc.body)
    const resting = () => ({ color: black, '-webkit-text-fill-color': black, 'background-color': clear })
    const selected = () => ({ color: white, '-webkit-text-fill-color': white, 'background-color': black })
    const a = f.element('button', nav, selected()), b = f.element('button', nav, resting())
    a.setAttribute('aria-selected', 'true')
    b.setAttribute('aria-selected', 'false')
    b.rect.top = 40
    const textColor = gray ? 'rgb(128, 128, 128)' : black
    const content = []
    const contentParent = article ? f.element('article', f.doc.body) : f.doc.body
    for (let i = 0; i < contentCount; i++) content.push(f.element('div', contentParent, {
        color: textColor, '-webkit-text-fill-color': textColor, 'background-color': white
    }))
    const originalNodes = f.doc.querySelectorAll('*')
    const totals = empty(), frames = [], phases = {}
    const instrumented = new WeakSet(), ruleStyles = new WeakSet()
    const pausedRules = new WeakSet()
    let recording = false, periodic
    const add = (key, count = 1) => { if (recording) totals[key] += count }

    function instrumentRule(rule) {
        if (ruleStyles.has(rule.style)) return
        ruleStyles.add(rule.style)
        const descriptor = Object.getOwnPropertyDescriptor(rule.style, 'cssText')
        if (descriptor?.set) Object.defineProperty(rule.style, 'cssText', {
            ...descriptor,
            set(value) {
                const before = descriptor.get.call(this)
                const clearing = before !== '' && value === ''
                const resuming = before === '' && value !== '' && pausedRules.has(rule)
                add('cssomRuleWrites')
                add(clearing || resuming ? 'samplingCssomRuleWrites' : 'otherCssomRuleWrites')
                if (clearing) pausedRules.add(rule)
                if (resuming) pausedRules.delete(rule)
                descriptor.set.call(this, value)
            }
        })
        let selector = rule.selectorText
        Object.defineProperty(rule, 'selectorText', {
            get: () => selector,
            set(value) { add('cssomRuleWrites'); add('otherCssomRuleWrites'); selector = value }
        })
    }

    function instrument(target) {
        if (instrumented.has(target)) return target
        instrumented.add(target)
        for (const method of ['setAttribute', 'removeAttribute']) {
            const original = target[method].bind(target)
            target[method] = (name, ...args) => {
                if (name.startsWith('data-eink-')) add('hookWrites')
                return original(name, ...args)
            }
        }
        const rect = target.getBoundingClientRect.bind(target)
        target.getBoundingClientRect = () => { add('rectReads'); return rect() }
        const query = target.querySelectorAll.bind(target)
        target.querySelectorAll = (...args) => {
            const result = query(...args)
            add('queryCalls'); add('queryNodeResults', result.length)
            return result
        }
        for (const method of ['setProperty', 'removeProperty']) {
            const original = target.style[method].bind(target.style)
            target.style[method] = (...args) => {
                if (target.isConnected) add('inlineWrites')
                return original(...args)
            }
        }
        const declaration = Object.getOwnPropertyDescriptor(target.style, 'cssText')
        if (declaration?.set) Object.defineProperty(target.style, 'cssText', {
            ...declaration,
            set(value) {
                if (target.isConnected) add('inlineWrites')
                declaration.set.call(this, value)
            }
        })
        const priority = target.style.getPropertyPriority.bind(target.style)
        target.style.getPropertyPriority = (...args) => {
            if (target.isConnected) add('inlinePriorityReads')
            return priority(...args)
        }
        if (target.sheet) {
            let disabled = target.sheet.disabled
            Object.defineProperty(target.sheet, 'disabled', {
                get: () => disabled,
                set(value) { if (value !== disabled) add('sheetToggles'); disabled = value }
            })
            const insert = target.sheet.insertRule.bind(target.sheet)
            target.sheet.insertRule = (...args) => {
                add('cssomRuleWrites'); add('otherCssomRuleWrites')
                const index = insert(...args)
                instrumentRule(target.sheet.cssRules[index])
                return index
            }
            const remove = target.sheet.deleteRule.bind(target.sheet)
            target.sheet.deleteRule = (...args) => { add('cssomRuleWrites'); add('otherCssomRuleWrites'); return remove(...args) }
        }
        return target
    }

    for (const target of originalNodes) instrument(target)
    const create = f.doc.createElement.bind(f.doc)
    f.doc.createElement = (...args) => instrument(create(...args))
    const query = f.doc.querySelectorAll.bind(f.doc)
    f.doc.querySelectorAll = (...args) => {
        const result = query(...args)
        add('queryCalls'); add('queryNodeResults', result.length)
        return result
    }
    const countedPolicy = {
        ...Policy,
        createPlanner(colors) {
            const planner = Policy.createPlanner(colors)
            return {
                ...planner,
                plan(records, ...args) {
                    add('plannerCalls'); add('plannerRecords', records.length)
                    return planner.plan(records, ...args)
                },
                planSteps(records, ...args) {
                    add('plannerCalls'); add('plannerRecords', records.length)
                    const iterator = planner.planSteps(records, ...args)
                    return {
                        [Symbol.iterator]() { return this },
                        next(...values) { add('plannerStepCalls'); return iterator.next(...values) },
                        return(...values) { return iterator.return(...values) },
                        throw(...values) { return iterator.throw(...values) }
                    }
                }
            }
        }
    }
    const styles = (target, pseudo) => {
        add('styleReads'); add(pseudo ? 'pseudoStyleReads' : 'mainStyleReads')
        const values = f.painted(target, pseudo)
        const props = Object.keys(values)
        const result = { ...values, getPropertyValue: name => values[name] || '', length: props.length,
            [Symbol.iterator]: () => props[Symbol.iterator]() }
        props.forEach((name, index) => { result[index] = name; result[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = values[name] })
        return result
    }
    const engine = Dom.createContrastEngine(C, countedPolicy, {
        styles, batchSize: 192, schedule: fn => frames.push(fn),
        repeat: fn => { periodic = fn; return 1 }, cancelRepeat: () => { periodic = null },
        createInlineStyles: Inline.createInlineStyles
    })

    function phase(name, trigger) {
        const before = { ...totals }, maxPerFrame = empty()
        let frameCount = 0
        recording = true
        trigger()
        totals.persistentPlanWrites = engine.stats().writes
        totals.samplingPlanWrites = engine.stats().samplingWrites || 0
        const synchronous = difference(totals, before)
        while (frames.length) {
            if (++frameCount > 1000) throw Error('The deterministic queue did not finish')
            const frameBefore = { ...totals }
            frames.shift()()
            totals.persistentPlanWrites = engine.stats().writes
            totals.samplingPlanWrites = engine.stats().samplingWrites || 0
            const counts = difference(totals, frameBefore)
            for (const key of keys) maxPerFrame[key] = Math.max(maxPerFrame[key], counts[key])
        }
        recording = false
        const stats = engine.stats()
        phases[name] = {
            ...difference(totals, before), frames: frameCount, synchronous, maxPerFrame,
            engine: Object.fromEntries(['nodes', 'roots', 'rules', 'writes', 'samplingWrites', 'inline', 'transactions', 'failures', 'pending', 'guardPasses', 'guardPlans']
                .map(key => [key, stats[key]]))
        }
        const measured = phases[name]
        measured.cssomCrossCheck = {
            rawRuleWrites: measured.cssomRuleWrites,
            temporarySamplingRuleWrites: measured.samplingCssomRuleWrites,
            otherRuleWrites: measured.otherCssomRuleWrites,
            enginePersistentPlanWrites: measured.persistentPlanWrites,
            engineSamplingWrites: measured.samplingPlanWrites,
            rawEqualsParts: measured.cssomRuleWrites === measured.samplingCssomRuleWrites + measured.otherCssomRuleWrites,
            samplingCounterMatchesRaw: measured.samplingCssomRuleWrites === measured.samplingPlanWrites
        }
        if (!measured.cssomCrossCheck.rawEqualsParts || !measured.cssomCrossCheck.samplingCounterMatchesRaw) {
            throw Error('Raw CSSOM measurements disagree with the engine sampling counter: ' + JSON.stringify(measured.cssomCrossCheck))
        }
        if (stats.failures || stats.pending) throw Error('The production engine did not reconcile: ' + JSON.stringify(phases[name].engine))
    }

    phase('initial', () => engine.start(f.doc))
    if (!phases.initial.plannerCalls) throw Error('Planner instrumentation did not observe initial production planning')
    phase('idleTick', () => periodic())
    phase('pointerover', () => { b.hover = true; f.doc.emit('pointerover', b) })
    phase('selectionClick', () => {
        a.source = resting(); b.source = selected()
        a.setAttribute('aria-selected', 'false'); b.setAttribute('aria-selected', 'true')
        f.doc.emit('click', b)
        f.mutations()
    })
    const selection = {
        previousBackground: f.painted(a)['background-color'],
        currentBackground: f.painted(b)['background-color'],
        currentForeground: f.painted(b).color
    }
    if (!sameColor(selection.previousBackground, clear) || !sameColor(selection.currentBackground, black) || !sameColor(selection.currentForeground, white)) {
        throw Error('Counters cannot certify an incorrect selected state: ' + JSON.stringify(selection))
    }
    const blackContent = content.filter(target => {
        const value = f.painted(target)
        return sameColor(value.color, black) && sameColor(value['-webkit-text-fill-color'], black)
    }).length
    if (blackContent !== contentCount) throw Error('The required content conversion did not complete')
    engine.stop()
    return { contentCount, contentParent: article ? 'article' : 'body', nodes: originalNodes.length,
        contentPaint: { background: white, foreground: textColor }, blackContent, selection, phases }
}

const report = {
    schema: 2,
    command: 'node tools/check-contrast-performance.js',
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    method: 'Deterministic call counters forwarding to production planner, DOM engine, rule layer and inline ledger; document and cascade use the existing test helper.',
    timing: 'No elapsed-time measurements or timing assertions. The document helper has a synthetic incrementing performance clock; engine timing fields are intentionally excluded.',
    definitions: {
        styleReads: 'Calls to the injected computed-style adapter, split into main and pseudo calls.',
        hookWrites: 'setAttribute/removeAttribute calls for data-eink-* attributes on document elements.',
        inlineWrites: 'setProperty/removeProperty calls on connected document elements; scratch declarations are excluded.',
        cssomRuleWrites: 'Raw CSS rule insertions, deletions, selector assignments and declaration updates, including temporary sampling changes.',
        samplingCssomRuleWrites: 'Observed temporary clearing and restoration of rule declarations. These are real CSSOM writes, even when persistent output is unchanged.',
        otherCssomRuleWrites: 'Raw CSSOM rule writes excluding the observed temporary sampling changes.',
        persistentPlanWrites: 'Delta of engine.stats().writes: persistent plan changes across output, base and guard layers; not a count of all raw CSSOM operations.',
        samplingPlanWrites: 'Delta of engine.stats().samplingWrites, cross-checked against the independently observed temporary CSSOM operations.',
        plannerRecords: 'Sum of record-array lengths passed to the actual production planner.',
        maxPerFrame: 'Largest count observed within one scheduled callback. Synchronous event work is reported separately.',
        pass: 'Input hashes remained stable, selected/content paints are correct, raw sampling counters agree, and local navigation planner inputs do not grow with unrelated content. No elapsed-time certificate is implied.'
    },
    before: initialHashes,
    fixtures: {}, pass: false
}

try {
    report.fixtures.white1000 = measure(1000)
    report.fixtures.white20 = measure(20)
    report.fixtures.gray1000 = measure(1000, true)
    report.fixtures.whiteArticle1000 = measure(1000, false, true)
    report.navigationComparison = Object.fromEntries(['pointerover', 'selectionClick'].map(phase => [phase,
        Object.fromEntries([['20', report.fixtures.white20], ['1000', report.fixtures.white1000]]
            .map(([size, fixture]) => [size, Object.fromEntries([...keys, 'frames'].map(key => [key, fixture.phases[phase][key]]))]))]))
    report.grayRequiredPaint = { nodes: report.fixtures.gray1000.nodes,
        initialHookWrites: report.fixtures.gray1000.phases.initial.hookWrites,
        maxFrameHookWrites: report.fixtures.gray1000.phases.initial.maxPerFrame.hookWrites }
    report.contracts = {}
    for (const phase of ['pointerover', 'selectionClick']) {
        const small = report.fixtures.white20.phases[phase], large = report.fixtures.white1000.phases[phase]
        const pass = small.plannerRecords === large.plannerRecords && (phase !== 'selectionClick' || small.plannerRecords > 0)
        report.contracts[phase + 'PlannerInputsIndependentOfContentCount'] = {
            pass, smallContent: 20, largeContent: 1000, smallPlannerRecords: small.plannerRecords, largePlannerRecords: large.plannerRecords
        }
        if (!pass) throw Error('Local navigation planner inputs grew with unrelated direct-body content: ' + phase)
    }
    report.after = { source: treeHash(path.join(root, 'src')), tests: treeHash(path.join(root, 'tests')) }
    report.inputsStable = report.before.source.hash === report.after.source.hash && report.before.tests.hash === report.after.tests.hash
    report.pass = report.inputsStable
    if (!report.inputsStable) report.error = 'Source or tests changed during measurement; rerun against stable files.'
} catch (error) {
    report.error = error.stack
}

process.stdout.write(JSON.stringify(report, null, 2) + '\n')
if (!report.pass) process.exitCode = 1

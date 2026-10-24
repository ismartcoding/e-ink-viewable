const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createComparisonDocument } = require('../tests/helpers/contrast-comparison-document')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
function option(name, fallback) {
    const index = args.indexOf(name)
    return index < 0 ? fallback : args[index + 1]
}
const sourcePath = path.resolve(option('--current-src', path.join(root, 'src')))
const oldRef = option('--old-ref', 'fc84ccc')
const sizes = option('--sizes', '1000,10000').split(',').map(Number)
const idleTicks = option('--idle-ticks', '12,120').split(',').map(Number)
const reconciliationRotations = Number(option('--max-reconciliation-rotations', '2'))
const output = option('--output', '')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const files = ['color.js', 'high-contrast/contrast.js', 'high-contrast/contrast-dom.js', 'high-contrast/contrast-inline.js', 'high-contrast/contrast-output.js', 'manifest.json']
const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'eink-contrast-comparison-'))
const snapshot = Object.fromEntries(files.map(name => [name, fs.readFileSync(path.join(sourcePath, name))]))
for (const [name, data] of Object.entries(snapshot)) {
    fs.mkdirSync(path.dirname(path.join(frozen, name)), { recursive: true })
    fs.writeFileSync(path.join(frozen, name), data)
}
const C = require(path.join(frozen, 'color.js'))
const Policy = require(path.join(frozen, 'high-contrast/contrast.js'))
const Dom = require(path.join(frozen, 'high-contrast/contrast-dom.js'))
const Inline = require(path.join(frozen, 'high-contrast/contrast-inline.js'))
function legacyModule(name) {
    const source = execFileSync('git', ['show', `${oldRef}:src/${name}.js`], { cwd: root, encoding: 'utf8' })
    const context = vm.createContext({ module: { exports: {} } })
    new vm.Script(source, { filename: `${oldRef}:src/${name}.js` }).runInContext(context)
    return { module: context.module.exports, hash: digest(source) }
}
const legacyColor = legacyModule('color'), legacyEngine = legacyModule('engine')
const black = 'rgb(0, 0, 0)', white = 'rgb(255, 255, 255)', clear = 'rgba(0, 0, 0, 0)'
function normalizedColor(value) {
    const parsed = C.parseColor(value)
    if (parsed) return [parsed.r, parsed.g, parsed.b, parsed.a].join(',')
    return value === '#000' ? '0,0,0,1' : value === '#fff' ? '255,255,255,1' : value === 'transparent' ? '0,0,0,0' : value
}
const sameColor = (a, b) => normalizedColor(a) === normalizedColor(b)

function buildFixture(count, gray) {
    const f = createComparisonDocument()
    const resting = () => ({ color: black, '-webkit-text-fill-color': black, 'background-color': clear })
    const selected = () => ({ color: white, '-webkit-text-fill-color': white, 'background-color': black })
    const nav = f.element('nav', f.doc.body)
    nav.textContent = ''
    const a = f.element('button', nav, selected()), b = f.element('button', nav, resting())
    a.textContent = 'Previous'; b.textContent = 'Current'
    a.setAttribute('aria-selected', 'true'); b.setAttribute('aria-selected', 'false')
    a.setAttribute('class', 'selected'); b.setAttribute('class', 'resting')
    b.rect.top = 40
    b.hoverSource = { color: black, '-webkit-text-fill-color': black, 'background-color': 'rgb(224, 224, 224)' }
    const rows = []
    const rowStyle = () => ({ color: gray ? 'rgb(128, 128, 128)' : black,
        '-webkit-text-fill-color': gray ? 'rgb(128, 128, 128)' : black,
        'background-color': gray ? 'rgb(230, 230, 230)' : white })
    for (let i = 0; i < count; i++) {
        const row = f.element('div', f.doc.body, rowStyle())
        row.textContent = `Row ${i}`
        row.rect.top = 80 + i * 32
        rows.push(row)
    }
    assert.equal(f.nodeCount(), count + 5)
    assert.equal(sameColor(f.painted(a).color, white), true)
    assert.equal(sameColor(f.painted(a)['background-color'], black), true)
    assert.equal(sameColor(f.painted(rows[0]).color, gray ? 'rgb(128, 128, 128)' : black), true)
    const inputHash = digest(JSON.stringify(f.doc.querySelectorAll('*').map(el => ({ tag: el.localName,
        attributes: [...el.attrs], source: el.source, hoverSource: el.hoverSource, rect: el.rect, text: el.textContent }))))
    return { ...f, nav, a, b, rows, resting, selected, rowStyle, inputHash }
}

function startCurrent(f) {
    const countedPolicy = { ...Policy, createPlanner(...args) {
        const planner = Policy.createPlanner(...args)
        return { ...planner,
            planSteps(records, ...rest) {
                f.add('plannerCalls'); f.add('plannerRecords', records.length)
                const iterator = planner.planSteps(records, ...rest)
                return { [Symbol.iterator]() { return this },
                    next(value) { f.add('plannerSteps'); return iterator.next(value) },
                    return(value) { return iterator.return(value) } }
            },
            plan(records, ...rest) {
                f.add('plannerCalls'); f.add('plannerRecords', records.length)
                return planner.plan(records, ...rest)
            }
        }
    } }
    const engine = Dom.createContrastEngine(C, countedPolicy, { styles: f.styles, schedule: f.schedule,
        repeat: f.repeat, cancelRepeat: f.cancelRepeat, createInlineStyles: Inline.createInlineStyles })
    return { start: () => engine.start(f.doc), engine }
}

function startOriginal(f) {
    const engine = legacyEngine.module
    let pass
    return { start() {
        const sheet = f.doc.createElement('style')
        sheet.textContent = engine.CONTRAST_TEXT
        f.doc.documentElement.appendChild(sheet)
        assert.equal(sameColor(f.painted(f.rows[0]).color, black), true,
            'The original wildcard stylesheet must affect computed styles before the original pass runs')
        pass = engine.createContrastPass(legacyColor.module, { styles: f.styles, schedule: f.schedule,
            applyCss: css => sheet.append(css) })
        pass.scanTree(f.doc.documentElement)
        const observer = new f.doc.defaultView.MutationObserver(records => pass.onMutations(records))
        observer.observe(f.doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
        f.doc.addEventListener('change', event => pass.applyFormChange(event.target))
    } }
}

function paintSummary(f, elements = f.rows) {
    const result = { nodes: elements.length, blackText: 0, whiteBackground: 0, blackGlyphPaint: 0 }
    for (const el of elements) {
        const value = f.painted(el)
        if (sameColor(value.color, black)) result.blackText++
        if (sameColor(value['-webkit-text-fill-color'], black)) result.blackGlyphPaint++
        if (sameColor(value['background-color'], white)) result.whiteBackground++
    }
    return result
}

function measure(kind, count, gray) {
    const f = buildFixture(count, gray), phases = {}, checks = {}
    const instance = kind === 'original' ? startOriginal(f) : startCurrent(f)
    const run = (name, trigger) => {
        phases[name] = f.phase(trigger)
        if (instance.engine) {
            const stats = instance.engine.stats()
            assert.equal(stats.failures, 0, stats.lastError)
            assert.equal(stats.pending, 0, `Pending production work after ${name}`)
            phases[name].engine = Object.fromEntries(['nodes', 'rules', 'writes', 'samplingWrites', 'transactions', 'failures', 'pending']
                .map(key => [key, stats[key]]))
        }
    }
    const merge = (total, next) => {
        for (const key of Object.keys(next)) {
            if (typeof next[key] === 'number') total[key] += next[key]
            else if (key === 'maxPerFrame') for (const metric of Object.keys(next[key])) total[key][metric] = Math.max(total[key][metric], next[key][metric])
            else if (key === 'synchronous') for (const metric of Object.keys(next[key])) total[key][metric] += next[key][metric]
        }
    }
    const runTicks = (name, ticks) => {
        run(name, f.tick)
        for (let i = 1; i < ticks; i++) merge(phases[name], f.phase(f.tick))
        phases[name].ticks = ticks
        if (instance.engine) {
            const stats = instance.engine.stats()
            assert.equal(stats.failures, 0, stats.lastError)
            assert.equal(stats.pending, 0)
            phases[name].engine = Object.fromEntries(['nodes', 'rules', 'writes', 'samplingWrites', 'transactions', 'failures', 'pending']
                .map(key => [key, stats[key]]))
        }
    }
    run('initial', instance.start)
    checks.initialContent = paintSummary(f)
    for (const key of ['blackText', 'blackGlyphPaint', 'whiteBackground']) assert.equal(checks.initialContent[key], count,
        `${kind} did not actually convert ${count} content rows (${key})`)
    if (kind === 'original') {
        assert.equal(f.rows[0].style.getPropertyValue('background'), '#fff', 'The original scan must write to real fixture rows')
        assert.equal(phases.initial.mainStyleReads, count + 5, 'The original pass must visit all fixture elements')
    } else assert.ok(phases.initial.plannerRecords >= count + 5)
    run('idleTick', f.tick)
    run('pointerover', () => {
        f.author(() => { f.b.hover = true })
        f.doc.emit('mouseover', f.b)
        f.doc.emit('pointerover', f.b)
    })
    checks.hover = { background: f.painted(f.b)['background-color'], color: f.painted(f.b).color }
    assert.equal(sameColor(checks.hover.color, black), true)
    run('selectionClick', () => {
        f.author(() => {
            f.b.hover = false
            f.a.source = f.resting(); f.b.source = f.selected()
            f.a.setAttribute('aria-selected', 'false'); f.b.setAttribute('aria-selected', 'true')
            f.a.setAttribute('class', 'resting'); f.b.setAttribute('class', 'selected')
        })
        f.doc.emit('click', f.b)
    })
    const previous = f.painted(f.a), selected = f.painted(f.b)
    checks.selection = { previousBackground: previous['background-color'], selectedBackground: selected['background-color'],
        selectedForeground: selected.color, selectedGlyph: selected['-webkit-text-fill-color'],
        distinguishable: !sameColor(previous['background-color'], selected['background-color']) }
    assert.equal(checks.selection.distinguishable, kind === 'current',
        'Selection gap must be reported, not hidden by a fixture: ' + JSON.stringify(checks.selection))
    if (kind === 'current') {
        assert.equal(sameColor(selected['background-color'], black), true)
        assert.equal(sameColor(selected.color, white), true)
        assert.equal(sameColor(selected['-webkit-text-fill-color'], white), true)
    }
    run('localClassUpdate', () => {
        f.author(() => {
            f.rows.at(-1).source = { color: white, '-webkit-text-fill-color': white, 'background-color': black }
            f.rows.at(-1).setAttribute('class', 'updated')
        })
    })
    checks.localClassUpdate = paintSummary(f, [f.rows.at(-1)])
    checks.localClassUpdate.expectedPlainContent = { blackText: 1, blackGlyphPaint: 1, whiteBackground: 1 }
    checks.localClassUpdate.converted = checks.localClassUpdate.blackText === 1
        && checks.localClassUpdate.blackGlyphPaint === 1 && checks.localClassUpdate.whiteBackground === 1
    checks.localClassUpdate.paint = f.painted(f.rows.at(-1))
    let additions
    run('addedSubtree', () => {
        f.author(() => {
            const group = f.element('article')
            group.textContent = ''
            group.rect.top = 80 + count * 32
            additions = []
            for (let i = 0; i < 32; i++) additions.push(f.element('div', group, f.rowStyle()))
            f.doc.body.appendChild(group)
        })
    })
    checks.addedSubtree = paintSummary(f, additions)
    for (const key of ['blackText', 'blackGlyphPaint', 'whiteBackground']) assert.equal(checks.addedSubtree[key], 32)
    run('secondIdleTick', () => {
        f.tick()
    })
    let cssomTicks = 0
    run('cssomUpdateWithoutMutation', () => {
        f.author(() => {
            f.rows.at(-2).source = { ...f.rows.at(-2).source,
                'outline-style': 'solid', 'outline-width': '3px', 'outline-color': 'rgb(255, 0, 0)' }
        })
        f.tick()
        cssomTicks++
    })
    const maxTicks = reconciliationRotations * Math.ceil(f.nodeCount() / 192) + 4
    while (kind === 'current' && !sameColor(f.painted(f.rows.at(-2))['outline-color'], black) && cssomTicks < maxTicks) {
        const next = f.phase(f.tick)
        merge(phases.cssomUpdateWithoutMutation, next)
        cssomTicks++
    }
    checks.cssomUpdateWithoutMutation = { ticks: cssomTicks, maximumTicks: maxTicks,
        outline: f.painted(f.rows.at(-2))['outline-color'], converted: sameColor(f.painted(f.rows.at(-2))['outline-color'], black) }
    assert.equal(checks.cssomUpdateWithoutMutation.converted, kind === 'current')
    run('idleAfterConvergence', f.tick)
    runTicks('stableIdleWarmup', 3 * Math.ceil(f.nodeCount() / 192) + 4)
    for (const ticks of idleTicks) {
        assert.ok(Number.isInteger(ticks) && ticks > 0)
        runTicks(`stableIdle${ticks}Ticks`, ticks)
    }
    if (instance.engine) {
        assert.equal(instance.engine.stats().pending, 0)
        assert.equal(instance.engine.stats().failures, 0)
    }
    if (instance.engine) instance.engine.stop()
    return { kind, count, input: gray ? 'gray background / gray text' : 'white background / black text', inputHash: f.inputHash,
        initialNodes: count + 5, phases, checks }
}

const report = {
    schema: 1, pass: false,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    harnessFiles: Object.fromEntries([__filename, require.resolve('../tests/helpers/contrast-comparison-document')]
        .map(file => [path.relative(root, file).split(path.sep).join('/'), digest(fs.readFileSync(file))])),
    method: 'Deterministic operation counters on the same document and modeled CSS cascade. Original color/engine are executed unchanged in VM from git; original Contrast stylesheet is active before scanning. Current production modules are frozen before loading. No wall-clock benchmark or claim about real browser frame rate.',
    scope: 'High contrast only. Comfort is not measured. Fixtures include all content rows, selected navigation, CSS hover, class changes, 32 added rows, and a CSSOM-only outline change.',
    batchSizes: { original: 400, current: 192, method: 'Unchanged production defaults, not artificially equalized.' },
    originalUnsupportedScenarios: ['Selected navigation state separation', 'CSSOM-only changes without DOM mutation'],
    original: { ref: oldRef, resolvedCommit: execFileSync('git', ['rev-parse', oldRef], { cwd: root, encoding: 'utf8' }).trim(),
        files: { 'color.js': legacyColor.hash, 'engine.js': legacyEngine.hash } },
    current: { sourcePath, version: JSON.parse(snapshot['manifest.json']).version,
        files: Object.fromEntries(Object.entries(snapshot).map(([name, data]) => [name, digest(data)])) },
    definitions: {
        styleReads: 'Actual injected computed-style calls, split into host/pseudo reads. The shared cascade model is outside performance counters.',
        geometryReads: 'Actual getBoundingClientRect calls by the engine.',
        inlineWrites: 'Actual setProperty/removeProperty/cssText writes on connected elements. Scratch declaration writes are excluded.',
        cssomWrites: 'Explicit insertRule/deleteRule/selectorText/declaration calls, including current temporary sampling writes.',
        stylesheetTextWrites: 'Style element textContent/append assignments; original blanket sheet parsing is counted separately from explicit CSSOM calls.',
        plannerRecords: 'Record-array lengths received by the current production policy. The original algorithm has no separate planner; mainStyleReads count its per-node pass.',
        idleTick: 'One 1000 ms periodic callback if that implementation has one. Original has no periodic reconciliation and therefore zero work.',
        cssomUpdateWithoutMutation: `Same red outline is authored without DOM mutation. Current receives at most ${reconciliationRotations}*ceil(nodes/192)+4 explicit periodic ticks until actually black; actual ticks and all work until conversion are reported. The original has no periodic path, retains red and is marked unsupported.`,
        stableIdle: 'Before the 12/120 tick samples, both engines receive 3*ceil(nodes/192)+4 explicit periodic ticks: one rotation may include the last change, followed by two quiet rotations. Warmup work is reported. Each measured tick corresponds to one production 1000 ms repeat callback. Original has no callback and does zero work. Synthetic scheduling provides operation counts, not measured elapsed time.',
        sideEffects: 'Fixture-author mutations are excluded; only extension-origin operations are counted.',
        limitations: 'The cascade supports the fixture properties and actual generated selectors; this is a deterministic operation comparison, not a general browser CSS implementation. Real browser measurements remain separate.'
    },
    fixtures: {}
}
try {
    for (const size of sizes) for (const gray of [false, true]) {
        assert.ok(Number.isInteger(size) && size > 1)
        const key = `${gray ? 'gray' : 'white'}${size}`
        report.fixtures[key] = { original: measure('original', size, gray), current: measure('current', size, gray) }
        assert.equal(report.fixtures[key].original.inputHash, report.fixtures[key].current.inputHash,
            'The original and current engines must receive exactly the same fixture input')
    }
    report.inputsStable = files.every(name => fs.readFileSync(path.join(sourcePath, name)).equals(snapshot[name]))
    assert.equal(report.inputsStable, true, 'Current source changed during measurement')
    report.currentFunctionalFailures = Object.entries(report.fixtures).filter(([, fixture]) => !fixture.current.checks.localClassUpdate.converted)
        .map(([fixture]) => ({ fixture, scenario: 'localClassUpdate', expectation: 'Ordinary content must remain white with black text' }))
    report.pass = report.currentFunctionalFailures.length === 0
} catch (error) {
    report.error = error.stack
} finally {
    fs.rmSync(frozen, { recursive: true, force: true })
    report.temporaryRemoved = !fs.existsSync(frozen)
}
const json = JSON.stringify(report, null, 2) + '\n'
if (output) fs.writeFileSync(path.resolve(output), json)
process.stdout.write(json)
if (!report.pass) process.exitCode = 1

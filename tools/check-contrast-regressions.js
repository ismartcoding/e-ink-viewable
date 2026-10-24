const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const mutations = [
    {
        id: 'current-location-as-selection', file: 'src/contrast-dom.js', testFile: 'tests/contrast-current-location.test.js',
        testName: 'a current-page home link does not gain an invented selected frame around its brand',
        replacements: [["|| (el.checked === true && !['checkbox', 'radio'].includes(el.type)) || el.selected === true",
            "|| (!!state('aria-current') && state('aria-current') !== 'false')\n                || (el.checked === true && !['checkbox', 'radio'].includes(el.type)) || el.selected === true"]]
    },
    {
        id: 'decorative-pseudo-state-cluster', file: 'src/contrast.js', testFile: 'tests/contrast-navigation-decoration.test.js',
        testName: 'a decorative mask icon does not invent a selected border on an ordinary navigation link',
        replacements: [['filter(([, p]) => surfacePseudo(baseline, p))',
            'filter(([, p]) => meaningful(p) && painted(p))']]
    },
    {
        id: 'backdrop-toolbar-protection', file: 'src/contrast.js', testFile: 'tests/contrast-backdrop.test.js',
        testName: 'backdrop-filter alone does not exempt a translucent toolbar from contrast',
        replacements: [['if (image(s) || pseudoImage || r.unsafe) protect(r)',
            'if (backdrop(s) || image(s) || pseudoImage || r.unsafe) protect(r)']]
    },
    {
        id: 'transparent-backdrop-surface', file: 'src/contrast.js', testFile: 'tests/contrast-backdrop.test.js',
        testName: 'backdrop-filter alone does not exempt a transparent toolbar from contrast',
        replacements: [['const own = painted(s) || backdrop(s) ||', 'const own = painted(s) ||']]
    },
    {
        id: 'media-parent-protection', file: 'src/contrast.js', testFile: 'tests/contrast.test.js',
        testName: 'a viewport background canvas and an offscreen positioned link do not protect the document',
        replacements: [
            ["if (parent && !fixedBackdrop && !['html', 'body'].includes(parent.tag)) {", 'if (parent) {'],
            ['const foregrounds = (children.get(parent.node) || []).filter(overlays)',
                "const foregrounds = (children.get(parent.node) || []).filter(child => ['absolute', 'fixed'].includes(child.style.position) && child.hasText)"],
            ['if (coversParent && foregrounds.length) {', 'if (foregrounds.length) {']
        ]
    },
    {
        id: 'comfort-stale-menu-paint', file: 'src/engine.js', testFile: 'tests/engine.test.js',
        testName: 'Comfort releases converted menu paint when its selected class is removed',
        replacements: [['force.add(el)\n        restoreStyles(el)\n        attrDirty.add(el)', 'force.add(el)\n        attrDirty.add(el)']]
    },
    {
        id: 'unpaired-selected-foreground', file: 'src/contrast.js', testFile: 'tests/contrast.test.js',
        testName: 'selected control keeps black fill and coordinated white foreground',
        replacements: [["const value = { bg, fg: bg === '#000' ? '#fff' : '#000',", "const value = { bg, fg: '#000',"]]
    },
    {
        id: 'masked-text-as-icon', file: 'src/contrast.js', testFile: 'tests/contrast.test.js',
        testName: 'a masked text field keeps contrasting glyphs instead of becoming a solid icon',
        replacements: [['if (!r.hasText && !r.hasChildren && !FORMS.has(r.tag) && !r.editable\n                    && (', 'if ((']]
    },
    {
        id: 'late-shadow-unscheduled', file: 'src/contrast-dom.js', testFile: 'tests/contrast-dom.test.js',
        testName: 'periodic checks discover a late shadow root and schedule its new nodes',
        replacements: [['                kick()\n            }, options.recheckInterval || 1000)', '            }, options.recheckInterval || 1000)']]
    },
    {
        id: 'periodic-background-refill', file: 'src/contrast-dom.js', testFile: 'tests/contrast-dom.test.js',
        testName: 'periodic ticks during every batch never refill completed background work',
        replacements: [['if (!background.size && !urgent.size && !guardQueue.size && !scheduled && !planning) {\n                    if (reconcileWait)', 'if (true) {\n                    if (reconcileWait)']]
    },
    {
        id: 'lost-author-inline-update', file: 'src/contrast-inline.js', testFile: 'tests/contrast-inline.test.js',
        testName: 'author changes during conversion become the new restoration state',
        replacements: [['entries.get(el).set(prop, { value, priority })', 'continue']]
    },
    {
        id: 'empty-native-popup-labels', file: 'src/popup.js', testFile: 'tests/popup-i18n.test.js',
        testName: 'follow browser renders every popup label even when native getMessage returns empty',
        replacements: [['return text(native) || text(messages?.[key]?.message) || text(fallback?.[key]?.message) || key',
            'return !lang ? chrome.i18n.getMessage(key) : text(messages?.[key]?.message) || text(fallback?.[key]?.message) || key']]
    },
    {
        id: 'local-event-global-resampling', file: 'src/contrast-dom.js', testFile: 'tests/contrast-performance.test.js',
        testName: 'local click work does not grow with unrelated article content',
        replacements: [["                invalidate(target)\n                if (target?.localName === 'input') {",
            "                invalidate(target)\n                sweep()\n                if (target?.localName === 'input') {"]]
    },
    {
        id: 'local-planning-global-input', file: 'src/contrast-dom.js', testFile: 'tests/contrast-performance.test.js',
        testName: 'changed local controls plan and render only their dependency region',
        replacements: [['const records = [...context].map(el => snapshots.get(el)).filter(Boolean)', 'const records = [...snapshots.values()]']]
    },
    {
        id: 'periodic-unbounded-sampling', file: 'src/contrast-dom.js', testFile: 'tests/contrast-performance.test.js',
        testName: 'periodic reconciliation is bounded and still detects unannounced CSSOM paint changes',
        replacements: [['while (count < batchSize) {', 'while (count < nodes.size) {']]
    },
    {
        id: 'local-inline-global-restoration', file: 'src/contrast-inline.js', testFile: 'tests/contrast-performance.test.js',
        testName: 'local sampling leaves unrelated important author styles untouched until their periodic turn',
        replacements: [['for (const el of scope || entries.keys()) {', 'for (const el of entries.keys()) {']]
    },
    {
        id: 'native-radio-peer-not-resampled', file: 'src/contrast-dom.js', testFile: 'tests/contrast-native-peers.test.js',
        testName: 'native radio selection transfers across separate containers without resampling ordinary content',
        replacements: [['for (const peer of new Set([target, ...peers])) if', 'for (const peer of [target]) if']]
    },
    {
        id: 'removed-shadow-descendants-retained', file: 'src/contrast-dom.js', testFile: 'tests/contrast-dom-boundaries.test.js',
        testName: 'removing a shadow host releases every shadow descendant and its inline ownership',
        replacements: [['                            for (const child of el.shadowRoot?.children || []) pending.push(child)\n', '']]
    },
    {
        id: 'local-svg-protection-lost', file: 'src/contrast-dom.js', testFile: 'tests/contrast-dom-boundaries.test.js',
        testName: 'a local multicolor SVG update preserves protection derived from other graphic branches',
        replacements: [['                if (record.svgRoot) { addTree(record.svgRoot); continue }\n', '']]
    },
    {
        id: 'local-photo-overlay-dependency-lost', file: 'src/contrast-dom.js', testFile: 'tests/contrast-dom-boundaries.test.js',
        testName: 'a local photo-card text update keeps protection derived from its positioned heading sibling',
        replacements: [["\n                    || (hasImage && sibling.hasText && ['absolute', 'fixed'].includes(sibling.style.position))", '']]
    },
    {
        id: 'unbounded-shared-paint-sampling', file: 'src/contrast-dom.js', testFile: 'tests/contrast-performance.test.js',
        testName: 'shared paint groups bound the members invalidated by periodic source sampling',
        replacements: [['const cohort = Math.floor((Number(ids.get(el)) - 1) / batchSize)', 'const cohort = 0']]
    },
    {
        id: 'filtered-toolbar-protection', file: 'src/contrast.js', testFile: 'tests/contrast-policy-boundaries.test.js',
        testName: 'filter:invert(1) on an ordinary toolbar cannot preserve a dark region',
        replacements: [['if (image(s) || pseudoImage || r.unsafe) protect(r)',
            "if (image(s) || pseudoImage || r.unsafe || s.filter && s.filter !== 'none') protect(r)"]]
    },
    {
        id: 'palette-overflow-region-protection', file: 'src/contrast.js', testFile: 'tests/contrast-policy-boundaries.test.js',
        testName: 'more than four UI colors still convert to white surfaces and a paired selected state',
        replacements: [['if (unique.length > 4) {', 'if (unique.length > 4) { for (const item of candidates) protect(item)']]
    },
    {
        id: 'unsafe-child-parent-protection', file: 'src/contrast.js', testFile: 'tests/contrast-policy-boundaries.test.js',
        testName: 'an unsafe opaque child cannot exempt the document or its ordinary siblings',
        replacements: [['if (image(s) || pseudoImage || r.unsafe) protect(r)',
            'if (r.unsafe && byNode.has(r.parent)) protect(byNode.get(r.parent)); if (image(s) || pseudoImage || r.unsafe) protect(r)']]
    },
    {
        id: 'ordinary-content-selected-fill', file: 'src/contrast.js', testFile: 'tests/contrast-policy-boundaries.test.js',
        testName: 'a color change on repeated noninteractive body content cannot turn it into a black selected surface',
        replacements: [['const filled = emphatic && (r.selected || action(r)) &&', 'const filled = emphatic &&']]
    },
    {
        id: 'local-important-owner-full-enumeration', file: 'src/contrast-inline.js', testFile: 'tests/contrast-inline-performance.test.js',
        testName: 'scoped plan removal restores that owner without visiting other converted elements',
        replacements: [['const candidates = scope || new Set([...entries.keys(), ...plans.keys()])',
            'const candidates = new Set([...entries.keys(), ...plans.keys()])']]
    },
    {
        id: 'local-plan-full-cache-copy', file: 'src/contrast-dom.js', testFile: 'tests/contrast-plan-cache.test.js',
        testName: 'a local selection update does not copy the full page plan cache',
        replacements: [['const updates = new Map()', 'const updates = new Map(rawPlans)']]
    },
    {
        id: 'idle-reconciliation-without-backoff', file: 'src/contrast-dom.js', testFile: 'tests/contrast-idle-performance.test.js',
        testName: 'a stable page skips expensive reconciliation on alternate ticks without sampling writes',
        replacements: [['reconcileDelay = stableRotations >= 2 ? 2 : 1', 'reconcileDelay = 1']]
    },
    {
        id: 'ordinary-peer-global-sampling', file: 'src/contrast-dom.js', testFile: 'tests/contrast-local-performance.test.js',
        testName: 'one ordinary white content class change does not process its repeated siblings',
        replacements: [['for (const child of actionPeers(el)) {', 'for (const child of parent.children || []) {']]
    },
    {
        id: 'pending-first-paint-gap', file: 'src/contrast-dom.js', testFile: 'tests/contrast-pending.test.js',
        testName: 'pending work stays visible between shared sampling and the first paint plan',
        replacements: [['Number(!!planning || pendingChanges.size > 0 || scheduled)', 'Number(!!planning)']]
    },
    {
        id: 'duplicate-initial-source-sampling', file: 'src/contrast-dom.js', testFile: 'tests/contrast-initial-sampling.test.js',
        testName: 'initial ordinary source reads are shared with transition preflight instead of repeated',
        replacements: [['const samples = initial && !paintStarted ? {} : null', 'const samples = null']]
    },
    {
        id: 'ancestor-full-text-assembly', file: 'src/contrast-dom.js', testFile: 'tests/contrast-dom-bookkeeping.test.js',
        testName: 'local sampling does not assemble all descendant text of document ancestors',
        replacements: [['hasText: hasText(el),', 'hasText: !!el.textContent.trim(),']]
    },
    {
        id: 'empty-guard-sheet-toggle', file: 'src/contrast-dom.js', testFile: 'tests/contrast-empty-guard.test.js',
        testName: 'a page without paint transitions never toggles an empty guard stylesheet',
        replacements: [['if (guardedRoots.has(root)) { guard.disable(true); suspendedGuards.push(guard) }',
            '{ guard.disable(true); suspendedGuards.push(guard) }']]
    },
    {
        id: 'unrelated-shadow-guard-toggle', file: 'src/contrast-dom.js', testFile: 'tests/contrast-empty-guard.test.js',
        testName: 'local ordinary content does not toggle an unrelated shadow transition guard',
        replacements: [['if (guardedRoots.has(root)) { guard.disable(true); suspendedGuards.push(guard) }',
            'if (guard.stats().rules) { guard.disable(true); suspendedGuards.push(guard) }']]
    },
    {
        id: 'equal-rgb-perceptual-work', file: 'src/contrast.js', testFile: 'tests/contrast-initial-policy-performance.test.js',
        testName: 'equal RGB values need no perceptual conversion even when alpha differs',
        replacements: [['if (a.r === b.r && a.g === b.g && a.b === b.b) return 0', '']]
    },
    {
        id: 'ordinary-content-perceptual-work', file: 'src/contrast.js', testFile: 'tests/contrast-initial-policy-performance.test.js',
        testName: 'ordinary repeated content with rgb(20,20,20) paint avoids perceptual color work unrelated to interaction',
        replacements: [['!codes.has(r.node) && action(r) && own && distance(rawBackground(r), rawParent) > COLOR_DISTANCE',
            'distance(rawBackground(r), rawParent) > COLOR_DISTANCE && !codes.has(r.node) && action(r) && own']]
    },
    {
        id: 'snapshot-source-serialization', file: 'src/contrast-dom.js', testFile: 'tests/contrast-initial-bookkeeping.test.js',
        testName: 'initial and unchanged source samples do not serialize retained snapshot copies',
        replacements: [['const prev = snapshots.get(el)\n            if (!prev || !sameSnapshot',
            'const prev = snapshots.get(el)\n            JSON.stringify({ ...next, transient: undefined, node: undefined, parent: undefined, control: undefined, svgRoot: undefined })\n            if (!prev || !sameSnapshot']]
    },
    {
        id: 'source-property-entry-allocations', file: 'src/contrast-dom.js', testFile: 'tests/contrast-initial-bookkeeping.test.js',
        testName: 'copying computed source properties does not allocate an entry pair for every property',
        replacements: [['const values = {}\n            for (const prop of Policy.SOURCE) values[prop] = style.getPropertyValue(prop)\n            return values',
            'return Object.fromEntries(Policy.SOURCE.map(prop => [prop, style.getPropertyValue(prop)]))']]
    },
    {
        id: 'text-leaf-walker-allocations', file: 'src/contrast-dom.js', testFile: 'tests/contrast-initial-bookkeeping.test.js',
        testName: 'text-only leaves do not construct a TreeWalker for their first nonempty text node',
        replacements: [["const first = el.firstChild\n            if (first?.nodeType === 3 && /\\S/.test(first.nodeValue || '')) return true\n", '']]
    }
]

const hash = value => crypto.createHash('sha256').update(value).digest('hex')
function treeHash(directory) {
    const digest = crypto.createHash('sha256')
    let files = 0
    function visit(relative) {
        for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
            const child = path.join(relative, name), absolute = path.join(directory, child)
            if (fs.statSync(absolute).isDirectory()) visit(child)
            else { digest.update(child.split(path.sep).join('/')); digest.update('\0'); digest.update(fs.readFileSync(absolute)); digest.update('\0'); files++ }
        }
    }
    visit('')
    return { algorithm: 'sha256', hash: digest.digest('hex'), files }
}
function parseTap(output) {
    const lines = output.split('\n'), results = [], totals = {}
    for (let i = 0; i < lines.length; i++) {
        const entry = lines[i].match(/^(not )?ok (\d+) - (.*)$/)
        if (entry) {
            let end = i + 1
            while (end < lines.length && !/^(?:not )?ok \d+ - |^# Subtest:|^1\.\./.test(lines[end])) end++
            results.push({ name: entry[3].replace(/ # (?:SKIP|TODO).*$/, ''), pass: !entry[1],
                skipped: / # SKIP(?: |$)/.test(entry[3]), diagnostic: lines.slice(i + 1, end).join('\n') })
        }
        const total = lines[i].match(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/)
        if (total) totals[total[1]] = Number(total[2])
    }
    return { results, totals }
}
function replaceUnique(source, before, after) {
    const index = source.indexOf(before)
    if (index < 0 || source.indexOf(before, index + before.length) >= 0) throw Error('Mutation anchor must occur exactly once')
    const result = source.slice(0, index) + after + source.slice(index + before.length)
    if (result === source) throw Error('Mutation did not change the source')
    return result
}

const report = { schema: 1, node: process.version, pass: false, baseline: null, mutations: [] }
const started = Date.now(), deadline = started + 120000
let temporary
function cleanup() {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true })
}
process.once('exit', cleanup)
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { cleanup(); process.exit(code) })

function run(args, limit) {
    const remaining = Math.min(limit, deadline - Date.now())
    if (remaining <= 0) throw Error('Regression verification exceeded its total time limit')
    const command = [process.execPath, ...args]
    const result = spawnSync(command[0], command.slice(1), { cwd: temporary, encoding: 'utf8', timeout: remaining, maxBuffer: 8 * 1024 * 1024 })
    const output = (result.stdout || '') + (result.stderr || '')
    return { command, status: result.status, signal: result.signal, executionError: result.error?.message || null,
        output, ...parseTap(output) }
}

try {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eink-regressions-'))
    report.workingDirectory = temporary
    for (const directory of ['src', 'tests']) fs.cpSync(path.join(root, directory), path.join(temporary, directory), { recursive: true })
    report.source = treeHash(path.join(temporary, 'src'))
    report.tests = treeHash(path.join(temporary, 'tests'))
    const testFiles = fs.readdirSync(path.join(temporary, 'tests')).filter(name => name.endsWith('.test.js')).sort().map(name => 'tests/' + name)
    const baseline = run(['--test', '--test-reporter=tap', ...testFiles], 60000)
    report.baseline = { command: baseline.command, status: baseline.status, totals: baseline.totals, executionError: baseline.executionError }
    report.baseline.failures = baseline.results.filter(test => !test.pass && !test.skipped)
        .map(test => ({ name: test.name, diagnostic: test.diagnostic.trim().slice(0, 2500) }))
    if (baseline.executionError || baseline.status !== 0 || !baseline.totals.pass || baseline.totals.fail !== 0
        || baseline.totals.cancelled !== 0 || baseline.totals.skipped !== 0 || baseline.totals.todo !== 0) {
        report.baseline.output = baseline.output.slice(-12000)
        throw Error('The complete unmodified test baseline must pass before injecting regressions')
    }
    const originals = new Map([...new Set(mutations.map(mutation => mutation.file))].map(file => [file, fs.readFileSync(path.join(temporary, file), 'utf8')]))
    for (const mutation of mutations) {
        const entry = { id: mutation.id, file: mutation.file, expectedTest: mutation.testName, pass: false }
        report.mutations.push(entry)
        try {
            for (const [file, source] of originals) fs.writeFileSync(path.join(temporary, file), source)
            const original = originals.get(mutation.file)
            const source = mutation.replacements.reduce((current, replacement) => replaceUnique(current, ...replacement), original)
            new vm.Script(source, { filename: mutation.file })
            fs.writeFileSync(path.join(temporary, mutation.file), source)
            entry.originalSourceHash = hash(original)
            entry.mutatedSourceHash = hash(source)
            const pattern = '^' + mutation.testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'
            const result = run(['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern, mutation.testFile], 5000)
            entry.command = result.command
            entry.status = result.status
            entry.totals = result.totals
            entry.output = result.output.slice(-12000)
            const target = result.results.find(test => test.name === mutation.testName && !test.skipped)
            const failures = result.results.filter(test => !test.pass && !test.skipped)
            const basicFailure = /SyntaxError:|ReferenceError:|TypeError:|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|ERR_TEST_TIMEOUT/.test(result.output)
            const assertion = target && !target.pass && /\bcode: ['"]ERR_ASSERTION['"]/.test(target.diagnostic)
            if (result.executionError || result.signal) throw Error(result.executionError || 'The test process was interrupted: ' + result.signal)
            if (basicFailure) throw Error('The mutation caused a runtime or dependency error rather than the expected assertion')
            if (!target) throw Error('The named regression test did not execute')
            if (result.status !== 1 || !assertion || failures.length !== 1 || failures[0] !== target
                || result.totals.tests !== 1 || result.totals.pass !== 0 || result.totals.fail !== 1
                || result.totals.cancelled !== 0 || result.totals.skipped !== 0 || result.totals.todo !== 0) {
                throw Error('The mutation survived or did not fail exclusively through the named regression assertion')
            }
            entry.detectedTest = target.name
            entry.errorCode = 'ERR_ASSERTION'
            entry.assertion = target.diagnostic.trim().slice(0, 2500)
            entry.pass = true
            delete entry.output
        } catch (error) {
            entry.error = error.message
        }
    }
    report.pass = report.mutations.length === mutations.length && report.mutations.every(mutation => mutation.pass)
} catch (error) {
    report.error = error.message
} finally {
    cleanup()
    report.temporaryRemoved = !temporary || !fs.existsSync(temporary)
    report.durationMs = Date.now() - started
    if (!report.temporaryRemoved) report.pass = false
    process.exitCode = report.pass ? 0 : 1
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}

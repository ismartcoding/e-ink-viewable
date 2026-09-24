const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color.js')
const Engine = require('../src/engine.js')
const { createRecorder, createStyles, makeRoot, createScheduler } = require('./fake-dom.js')

function setup(overrides = {}) {
    const recorder = createRecorder()
    const table = overrides.computed || new Map()
    const scheduler = createScheduler()
    const css = []
    const delays = []    // {fn, ms} — armed transition re-checks, run by hand
    const cancelled = [] // handles cancelled by a newer re-check
    const engine = Engine.createEngine(C, {
        styles: createStyles(recorder, table),
        schedule: scheduler.schedule,
        applyCss: text => css.push(text),
        batchSize: overrides.batchSize,
        delay: (fn, ms) => {
            delays.push({ fn, ms })
            return delays.length
        },
        cancelDelay: handle => cancelled.push(handle)
    })
    return { recorder, scheduler, engine, table, css, delays, cancelled }
}

// recorder.el is wired to the shared write log; shorthand here.
function el(recorder, tag, opts) {
    return recorder.el(tag, opts)
}

function style(overrides = {}) {
    return {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'none',
        color: 'rgb(51, 51, 51)',
        borderColor: 'rgba(0, 0, 0, 0)', // no border
        fill: 'none',
        stroke: 'none',
        caretColor: 'auto',
        ...overrides
    }
}

test('skip rules: scripts, styles, svg internals and text nodes are never read', () => {
    const { recorder, engine, scheduler, css } = setup()
    const root = el(recorder, 'div')
    const script = el(recorder, 'script', { parent: root })
    const styleEl = el(recorder, 'style', { parent: root })
    const svgDefs = el(recorder, 'defs', { parent: root, ownerSvg: root })
    const svgFilter = el(recorder, 'feGaussianBlur', { parent: root, ownerSvg: root })
    const textNode = { nodeType: 3, parentElement: root }
    root.querySelectorAll = () => [script, styleEl, svgDefs, svgFilter, textNode]

    engine.enqueueTree(root)
    scheduler.runAll()

    // only the (non-skipped) root itself is processed: element + 2 pseudos
    assert.equal(recorder.reads().length, 3)
    assert.ok(recorder.reads().every(e => e[1] === root))
    assert.equal(recorder.writes().length, 0)
    assert.equal(css.length, 0)
})

test('dark backgrounds flip to white, translucent keeps its alpha, light stays', () => {
    const { recorder, engine, scheduler, table } = setup()
    const dark = el(recorder, 'div')
    const overlay = el(recorder, 'div')
    const light = el(recorder, 'div')
    table.set(dark, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(overlay, style({ backgroundColor: 'rgba(0, 0, 0, 0.85)' }))
    table.set(light, style({ backgroundColor: 'rgb(239, 239, 239)', color: 'rgb(9, 105, 218)' }))

    engine.enqueueTree(makeRoot(light, [dark, overlay, light]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(dark), { 'background-color': '#fff' })
    assert.deepEqual(recorder.props(overlay), { 'background-color': 'rgba(255, 255, 255, 0.85)' })
    assert.deepEqual(recorder.props(light), {}) // light page: untouched
})

test('text: near-white flips to black at 165, grays and links are kept', () => {
    const { recorder, engine, scheduler, table } = setup()
    const white = el(recorder, 'p')
    const boundary = el(recorder, 'p')
    const kept = el(recorder, 'p')
    const svgIcon = el(recorder, 'path', { ownerSvg: white })
    table.set(white, style({ color: 'rgb(232, 230, 255)' }))
    table.set(boundary, style({ color: 'rgb(166, 166, 166)' }))
    table.set(kept, style({ color: 'rgb(165, 165, 165)' }))
    table.set(svgIcon, style({ fill: 'rgb(255, 255, 255)', stroke: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(white, [white, boundary, kept, svgIcon]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(white), { color: '#000' })
    assert.deepEqual(recorder.props(boundary), { color: '#000' })
    assert.deepEqual(recorder.props(kept), {})
    // svg shapes away from images: white paint follows the (black) text color
    assert.deepEqual(recorder.props(svgIcon), { fill: 'currentColor', stroke: 'currentColor' })
})

test('borders: near-invisible ones darken to black, visible ones stay', () => {
    const { recorder, engine, scheduler, table } = setup()
    const lightBordered = el(recorder, 'div')
    const darkBordered = el(recorder, 'div')
    const transparent = el(recorder, 'div')
    table.set(lightBordered, style({ borderColor: 'rgb(208, 215, 222)' }))
    table.set(darkBordered, style({ borderColor: 'rgb(48, 54, 61)' }))
    table.set(transparent, style({ borderColor: 'rgba(0, 0, 0, 0)' }))

    engine.enqueueTree(makeRoot(lightBordered, [lightBordered, darkBordered, transparent]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(lightBordered), { 'border-color': '#000' })
    assert.deepEqual(recorder.props(darkBordered), {}) // dark border stays
    assert.deepEqual(recorder.props(transparent), {}) // transparent: spacing trick
})

test('glyph paint: -webkit-text-fill-color and accent-color flip with the text', () => {
    const { recorder, engine, scheduler, table } = setup()
    const bothWhite = el(recorder, 'button')
    const fillOnly = el(recorder, 'button')
    const checkbox = el(recorder, 'input')
    table.set(bothWhite, style({ color: 'rgb(255, 255, 255)', webkitTextFillColor: 'rgb(255, 255, 255)' }))
    table.set(fillOnly, style({ color: 'rgb(30, 30, 30)', webkitTextFillColor: 'rgb(255, 255, 255)' }))
    table.set(checkbox, style({ accentColor: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(bothWhite, [bothWhite, fillOnly, checkbox]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(bothWhite), { color: '#000', '-webkit-text-fill-color': '#000' })
    assert.deepEqual(recorder.props(fillOnly), { '-webkit-text-fill-color': '#000' })
    assert.deepEqual(recorder.props(checkbox), { 'accent-color': '#000' })
})

test('placeholder: light placeholder paint becomes a generated black rule', () => {
    const { recorder, engine, scheduler, table, css } = setup()
    const field = el(recorder, 'input')
    const area = el(recorder, 'textarea')
    const plain = el(recorder, 'div')
    table.set(field, style({ color: 'rgb(255, 255, 255)' }))
    table.set(area, style({ color: 'rgb(255, 255, 255)' }))
    field._pseudo = { '::placeholder': style({ color: 'rgb(222, 228, 236)' }) } // light: flipped
    area._pseudo = { '::placeholder': style({ color: 'rgb(117, 117, 117)' }) }  // default gray: kept
    plain._pseudo = { '::placeholder': style({ color: 'rgb(222, 228, 236)' }) } // wrong tag: never read

    engine.enqueueTree(makeRoot(field, [field, area, plain]))
    scheduler.runAll()

    assert.deepEqual(css, ['[data-eink-p="1"]::placeholder{color:#000!important}'])
    // the placeholder read happens for inputs/textareas only
    assert.deepEqual(recorder.reads().filter(r => r[2] === '::placeholder').map(r => r[1]), [field, area])
})

test('inputs and editable areas get a visible caret, imgs never get text writes', () => {
    const { recorder, engine, scheduler, table } = setup()
    const input = el(recorder, 'input')
    const editable = el(recorder, 'div', { contentEditable: true })
    const img = el(recorder, 'img')
    table.set(input, style({ color: 'rgb(255, 255, 255)', caretColor: 'rgb(255, 255, 255)', backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(editable, style({ caretColor: 'rgb(255, 255, 255)' }))
    table.set(img, style({ backgroundColor: 'rgb(13, 17, 23)', color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(input, [input, editable, img]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(input), {
        'background-color': '#fff',
        color: '#000',
        'caret-color': '#000'
    })
    assert.deepEqual(recorder.props(editable), { 'caret-color': '#000' })
    // img: background still flips, but color is meaningless for it
    assert.deepEqual(recorder.props(img), { 'background-color': '#fff' })
})

test('dark gradients are cleared, light gradients and url() images stay', () => {
    const { recorder, engine, scheduler, table } = setup()
    const darkGradient = el(recorder, 'div')
    const gradientWithImage = el(recorder, 'div')
    const lightGradient = el(recorder, 'div')
    table.set(darkGradient, style({ backgroundImage: 'linear-gradient(rgb(29, 30, 32), rgb(64, 66, 71))' }))
    table.set(gradientWithImage, style({
        backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6)), url("banner.jpg")',
        color: 'rgb(255, 255, 255)'
    }))
    table.set(lightGradient, style({ backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(240, 240, 240))' }))

    engine.enqueueTree(makeRoot(darkGradient, [darkGradient, gradientWithImage, lightGradient]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(darkGradient), {
        'background-image': 'none',
        'background-color': '#fff'
    })
    // image stays (its kind is 'image'), so the white text is kept too
    assert.deepEqual(recorder.props(gradientWithImage), {})
    assert.deepEqual(recorder.props(lightGradient), {})
})

test('over a background image text, borders and svg paints keep the page color', () => {
    const { recorder, engine, scheduler, table } = setup()
    const banner = el(recorder, 'section')
    const h1 = el(recorder, 'h1', { parent: banner })
    const icon = el(recorder, 'path', { parent: banner, ownerSvg: banner })
    const card = el(recorder, 'div', { parent: banner }) // white card on the photo
    const cardText = el(recorder, 'p', { parent: card })
    table.set(banner, style({ backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'url("banner.jpg")' }))
    table.set(h1, style({ color: 'rgb(255, 255, 255)', borderColor: 'rgb(208, 215, 222)' }))
    table.set(icon, style({ fill: 'rgb(255, 255, 255)' }))
    table.set(card, style({ backgroundColor: 'rgb(255, 255, 255)' }))
    table.set(cardText, style({ color: 'rgb(104, 113, 136)' }))

    engine.enqueueTree(makeRoot(banner, [banner, h1, icon, card, cardText]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(banner), {}) // transparent bg over image: nothing to write
    assert.deepEqual(recorder.props(h1), {}) // white text and border stay as chosen for the photo
    assert.deepEqual(recorder.props(icon), {})
    assert.deepEqual(recorder.props(card), {}) // already white
    assert.deepEqual(recorder.props(cardText), {}) // mid gray: kept anyway
})

test('a dark opaque card inside a banner still flips, and its text flips with it', () => {
    const { recorder, engine, scheduler, table } = setup()
    const banner = el(recorder, 'section')
    const card = el(recorder, 'div', { parent: banner })
    const text = el(recorder, 'p', { parent: card })
    table.set(banner, style({ backgroundImage: 'url("banner.jpg")' }))
    table.set(card, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(text, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(banner, [banner, card, text]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(card), { 'background-color': '#fff' })
    assert.deepEqual(recorder.props(text), { color: '#000' }) // card resolves 'light'
})

test('transparent elements inherit the nearest ancestor kind, null when none', () => {
    const { recorder, engine, scheduler, table } = setup()
    const darkPanel = el(recorder, 'div')
    const inner = el(recorder, 'span', { parent: darkPanel })
    const orphan = el(recorder, 'span')
    table.set(darkPanel, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(inner, style({ color: 'rgb(255, 255, 255)' }))
    table.set(orphan, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(darkPanel, [darkPanel, inner, orphan]))
    scheduler.runAll()

    // dark panel flips to white, so the white text inside flips to black
    assert.deepEqual(recorder.props(inner), { color: '#000' })
    // no processed ancestor: kind null → text still flips (plain page case)
    assert.deepEqual(recorder.props(orphan), { color: '#000' })
})

test('batching: only batchSize elements per frame, one frame at a time', () => {
    const { recorder, engine, scheduler, table } = setup({ batchSize: 2 })
    const els = []
    for (let i = 0; i < 5; i++) {
        const p = el(recorder, 'p')
        table.set(p, style({ color: 'rgb(255, 255, 255)' }))
        els.push(p)
    }

    engine.enqueueTree(makeRoot(els[0], els))
    assert.equal(scheduler.frames.length, 1) // one frame requested for the whole tree

    scheduler.runFrame()
    assert.equal(recorder.writes().length, 2)
    assert.equal(scheduler.frames.length, 1) // follow-up requested

    scheduler.runFrame()
    assert.equal(recorder.writes().length, 4)

    scheduler.runFrame()
    assert.equal(recorder.writes().length, 5)
    assert.equal(scheduler.frames.length, 0) // queue empty → idle, no more frames
})

test('elements are processed exactly once even when enqueued twice', () => {
    const { recorder, engine, scheduler, table } = setup()
    const p = el(recorder, 'p')
    table.set(p, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueue(p)
    engine.enqueue(p)
    engine.enqueueTree(makeRoot(p, [p]))
    scheduler.runAll()

    assert.equal(recorder.reads().length, 3) // element + 2 pseudos
    assert.equal(recorder.writes().length, 1)
})

test('reads for the whole batch happen before any write', () => {
    const { recorder, engine, scheduler, table } = setup()
    const a = el(recorder, 'div')
    const b = el(recorder, 'div', { parent: a })
    table.set(a, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(b, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(a, [a, b]))
    scheduler.runAll()

    const lastRead = recorder.log.map((e, i) => [e[0], i]).filter(([t]) => t === 'read').pop()[1]
    const firstWrite = recorder.log.findIndex(e => e[0] === 'write')
    assert.ok(firstWrite > lastRead)
})

test('mutations: added elements and their subtrees are processed, text nodes ignored', () => {
    const { recorder, engine, scheduler, table } = setup()
    const added = el(recorder, 'div')
    const child = el(recorder, 'p', { parent: added })
    const textNode = { nodeType: 3 }
    table.set(added, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(child, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueueMutations([{ addedNodes: [makeRoot(added, [child]), textNode] }])
    assert.equal(scheduler.frames.length, 1)

    scheduler.runAll()
    assert.deepEqual(recorder.props(added), { 'background-color': '#fff' })
    assert.deepEqual(recorder.props(child), { color: '#000' })
})

test('hover: target and ancestors are re-planned even when already processed', () => {
    const { recorder, engine, scheduler, table } = setup()
    const nav = el(recorder, 'nav')
    const link = el(recorder, 'a', { parent: nav })
    table.set(nav, style({ backgroundColor: 'rgb(255, 255, 255)' }))
    table.set(link, style({ color: 'rgb(9, 105, 218)' }))

    engine.enqueueTree(makeRoot(nav, [nav, link]))
    scheduler.runAll()
    assert.equal(recorder.writes().length, 0) // light page: nothing

    // hover with a :hover rule that turns the link dark — computed styles
    // already reflect it when the engine reads them
    table.set(link, style({ color: 'rgb(9, 105, 218)', backgroundColor: 'rgb(0, 0, 0)' }))
    engine.applyPointerTarget(link)
    scheduler.runAll()

    assert.deepEqual(recorder.props(link), { 'background-color': '#fff' })
    assert.ok(recorder.reads().length > 2) // nav + link re-read
})

test('hover over an image banner keeps white text white', () => {
    const { recorder, engine, scheduler, table } = setup()
    const banner = el(recorder, 'div')
    const link = el(recorder, 'a', { parent: banner })
    table.set(banner, style({ backgroundImage: 'url("banner.jpg")' }))
    table.set(link, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(banner, [banner, link]))
    scheduler.runAll()
    assert.equal(recorder.writes().length, 0)

    engine.applyPointerTarget(link)
    assert.equal(recorder.writes().length, 0) // stays the site's white
})

test('hover chain is capped at 32 elements', () => {
    const { recorder, engine, scheduler, table } = setup()
    const root = el(recorder, 'div')
    let deepest = root
    for (let i = 0; i < 40; i++) {
        deepest = el(recorder, 'div', { parent: deepest })
    }
    table.set(deepest, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(root, [root, deepest]))
    scheduler.runAll()
    engine.applyPointerTarget(deepest)

    // load pass: 2 elements × 3 reads (element + 2 pseudos) = 6;
    // hover pass reads element styles only: 32 × 1 = 32
    const hoverReads = recorder.reads().length - 6
    assert.equal(hoverReads, 32)
})

test('pseudo-elements: dark ::after overlay over a ::before image flips like a solid dark card', () => {
    // The vite.dev "Get Started" pattern: the dark look comes entirely from
    // ::before (dark texture jpg) + ::after (opaque dark overlay). The
    // topmost opaque layer (::after) decides: dark → flip the overlay white,
    // flip the button text black; the ::before image needs no writes.
    const { recorder, engine, scheduler, table, css } = setup()
    const btn = el(recorder, 'a')
    table.set(btn, style({ color: 'rgb(255, 255, 255)' }))
    btn._pseudo = {
        '::before': style({ backgroundImage: 'url("https://vite.dev/assets/tex.jpg")' }),
        '::after': style({ backgroundColor: 'rgb(22, 23, 29)' })
    }

    engine.enqueueTree(makeRoot(btn, [btn]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(btn), { color: '#000' }) // composite is dark → text flips
    assert.equal(btn.getAttribute('data-eink-p'), '1')
    assert.equal(css.length, 1)
    const rule = css[0]
    assert.match(rule, /\[data-eink-p="1"\]::after\{background-color:#fff!important\}/)
    assert.doesNotMatch(rule, /::before/) // image layer: nothing to write
})

test('pseudo-elements: a url image pseudo alone makes the host an image surface', () => {
    // Banner-style ::before image: the site's white text stays white.
    const { recorder, engine, scheduler, table, css } = setup()
    const banner = el(recorder, 'div')
    const link = el(recorder, 'a', { parent: banner })
    table.set(banner, style({}))
    banner._pseudo = { '::before': style({ backgroundImage: 'url("banner.jpg")' }) }
    table.set(link, style({ color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(banner, [banner, link]))
    scheduler.runAll()

    assert.equal(recorder.writes().length, 0)
    assert.equal(css.length, 0)
    assert.equal(link.getAttribute('data-eink-p'), null)
})

test('pseudo-elements: no pseudo styles → no attributes and no css', () => {
    const { recorder, engine, scheduler, table, css } = setup()
    const plain = el(recorder, 'div')
    table.set(plain, style({ color: 'rgb(51, 51, 51)' }))

    engine.enqueueTree(makeRoot(plain, [plain]))
    scheduler.runAll()

    assert.equal(css.length, 0)
    assert.equal(plain.getAttribute('data-eink-p'), null)
})

test('pseudo-elements: generated rules carry the color-only decisions', () => {
    // light ::before with white content text → color flip inside the rule
    const { recorder, engine, scheduler, table, css } = setup()
    const box = el(recorder, 'div')
    table.set(box, style({}))
    box._pseudo = {
        '::before': style({ color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(255, 255, 255)' })
    }

    engine.enqueueTree(makeRoot(box, [box]))
    scheduler.runAll()

    assert.equal(css.length, 1)
    assert.match(css[0], /\[data-eink-p="1"\]::before\{color:#000!important\}/)
})

test('background-clip:text: a light gradient is the text paint and becomes solid black', () => {
    // The astro.build CTA pattern: color transparent + gradient clipped to
    // the glyphs. Clearing the "background" without replacing the paint made
    // the text invisible.
    const { recorder, engine, scheduler, table } = setup()
    const pill = el(recorder, 'a')
    const span = el(recorder, 'span', { parent: pill })
    table.set(pill, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(span, {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(255, 214, 236))',
        backgroundClip: 'text',
        webkitBackgroundClip: 'text',
        color: 'rgba(0, 0, 0, 0)',
        borderColor: 'rgb(0, 0, 0)',
        fill: 'none',
        stroke: 'none',
        caretColor: 'auto'
    })

    engine.enqueueTree(makeRoot(pill, [pill, span]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(pill), { 'background-color': '#fff' })
    assert.deepEqual(recorder.props(span), {
        'background-image': 'none',
        'background-color': 'rgba(0, 0, 0, 0)',
        color: '#000',
        '-webkit-text-fill-color': '#000'
    })
})

test('background-clip:text: a dark gradient stays (readable on flipped white)', () => {
    const { recorder, engine, scheduler, table } = setup()
    const box = el(recorder, 'div')
    const span = el(recorder, 'span', { parent: box })
    table.set(box, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(span, {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'linear-gradient(rgb(64, 66, 71), rgb(29, 30, 32))',
        backgroundClip: 'text',
        color: 'rgba(0, 0, 0, 0)',
        borderColor: 'rgb(0, 0, 0)',
        fill: 'none',
        stroke: 'none',
        caretColor: 'auto'
    })

    engine.enqueueTree(makeRoot(box, [box, span]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(box), { 'background-color': '#fff' })
    assert.deepEqual(recorder.props(span), {}) // dark gradient paint: left alone
})

test('hover over a transitioning tab: the flip lands after the transition ends', () => {
    // The vite.dev code-group tabs pattern: color transitions in 0.25s on
    // hover, so the pass at mouseover reads the transition's start (gray)
    // and keeps it — the re-check after the transition must catch the white.
    const { recorder, engine, scheduler, table, delays } = setup()
    const bar = el(recorder, 'div')
    const tab = el(recorder, 'a', { parent: bar })
    table.set(bar, style({ backgroundColor: 'rgb(20, 18, 26)' }))
    table.set(tab, style({
        color: 'rgb(152, 152, 159)',
        transitionProperty: 'color',
        transitionDuration: '0.25s',
        transitionDelay: '0s'
    }))

    engine.enqueueTree(makeRoot(bar, [bar, tab]))
    scheduler.runAll()
    assert.deepEqual(recorder.props(tab), {}) // mid gray: kept
    assert.equal(delays.length, 0)            // the load pass arms nothing

    engine.applyPointerTarget(tab)            // hover: still reads gray
    assert.deepEqual(recorder.props(tab), {})
    assert.equal(delays.length, 1)
    assert.equal(delays[0].ms, 280)           // 250ms transition + 30ms slack

    table.set(tab, style({ color: 'rgb(255, 255, 255)' })) // hover color landed
    delays[0].fn()
    scheduler.runAll() // the re-check goes through the batched queue
    assert.deepEqual(recorder.props(tab), { color: '#000' })
})

test('hover: transitions that cannot carry a color arm nothing', () => {
    const { recorder, engine, scheduler, table, delays } = setup()
    const transform = el(recorder, 'a')
    const instant = el(recorder, 'a')
    table.set(transform, style({ color: 'rgb(255, 255, 255)', transitionProperty: 'transform', transitionDuration: '0.3s' }))
    table.set(instant, style({ color: 'rgb(255, 255, 255)', transitionProperty: 'color', transitionDuration: '0s' }))

    engine.enqueueTree(makeRoot(transform, [transform, instant]))
    scheduler.runAll()
    engine.applyPointerTarget(instant)

    assert.equal(delays.length, 0)
})

test('hover: re-checks share one timer, a new element resets it', () => {
    const { recorder, engine, scheduler, table, delays, cancelled } = setup()
    const a = el(recorder, 'a')
    const b = el(recorder, 'a')
    table.set(a, style({ color: 'rgb(255, 255, 255)', transitionProperty: 'color', transitionDuration: '0.2s' }))
    table.set(b, style({ color: 'rgb(255, 255, 255)', transitionProperty: 'color', transitionDuration: '0.3s' }))
    engine.enqueueTree(makeRoot(a, [a, b]))
    scheduler.runAll()

    engine.applyPointerTarget(a)
    assert.equal(delays.length, 1)
    assert.equal(delays[0].ms, 230)

    engine.applyPointerTarget(b) // joins the same pending tick, later deadline wins
    assert.equal(delays.length, 2)
    assert.deepEqual(cancelled, [1])
    assert.equal(delays[1].ms, 330)

    engine.applyPointerTarget(a) // already armed: no third timer
    assert.equal(delays.length, 2)
    assert.deepEqual(cancelled, [1])
})

test('form change: the checked control\'s siblings are re-planned past the seen check', () => {
    // vite.dev tabs again: input:checked + label turns the label white with
    // no added node and no pointer event — only a change event sees it.
    const { recorder, engine, scheduler, table, delays } = setup()
    const bar = el(recorder, 'div')
    const radio = el(recorder, 'input', { parent: bar })
    const label = el(recorder, 'label', { parent: bar })
    table.set(bar, style({ backgroundColor: 'rgb(20, 18, 26)' }))
    table.set(label, style({ color: 'rgb(152, 152, 159)', transitionProperty: 'color', transitionDuration: '0.25s' }))

    engine.enqueueTree(makeRoot(bar, [bar, radio, label]))
    scheduler.runAll()
    assert.deepEqual(recorder.props(label), {})

    // checking the radio flips the label's color — transitioning in
    table.set(label, style({ color: 'rgb(152, 152, 159)', transitionProperty: 'color', transitionDuration: '0.25s' }))
    engine.applyFormChange(radio)
    scheduler.runAll()
    assert.deepEqual(recorder.props(label), {}) // start of transition: still gray
    assert.equal(delays.length, 1)              // the drain armed the re-check

    table.set(label, style({ color: 'rgb(255, 255, 255)' }))
    delays[0].fn()
    scheduler.runAll() // the re-check goes through the batched queue
    assert.deepEqual(recorder.props(label), { color: '#000' })
})

test('class change: a dark-theme toggle re-plans the node and its descendants', () => {
    const { recorder, engine, scheduler, table } = setup()
    const box = el(recorder, 'div')
    const text = el(recorder, 'p', { parent: box })
    table.set(box, style({ backgroundColor: 'rgb(239, 239, 239)' }))
    table.set(text, style({ color: 'rgb(51, 51, 51)' }))

    engine.enqueueTree(makeRoot(box, [box, text]))
    scheduler.runAll()
    assert.deepEqual(recorder.props(box), {})

    // site-wide dark class: the box and everything inside it go dark
    table.set(box, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(text, style({ color: 'rgb(255, 255, 255)' }))
    engine.enqueueMutations([{ type: 'attributes', target: box, addedNodes: [] }])
    scheduler.runAll()

    assert.deepEqual(recorder.props(box), { 'background-color': '#fff' })
    assert.deepEqual(recorder.props(text), { color: '#000' })
})

test('class change: churn with no color change neither writes nor expands', () => {
    const { recorder, engine, scheduler, table } = setup()
    const box = el(recorder, 'div')
    const child = el(recorder, 'p', { parent: box })
    table.set(box, style({ backgroundColor: 'rgb(239, 239, 239)' }))
    table.set(child, style({ color: 'rgb(51, 51, 51)' }))

    engine.enqueueTree(makeRoot(box, [box, child]))
    scheduler.runAll()
    const readsBefore = recorder.reads().length

    table.set(box, style({ backgroundColor: 'rgb(239, 239, 239)' })) // layout-only class
    engine.enqueueMutations([{ type: 'attributes', target: box, addedNodes: [] }])
    scheduler.runAll()

    assert.equal(recorder.writes().length, 0)
    // box re-read (element + 2 pseudos), child untouched
    assert.equal(recorder.reads().length, readsBefore + 3)
})

test('perf lock: re-plans with unchanged values write nothing new', () => {
    const { recorder, engine, scheduler, table } = setup()
    const box = el(recorder, 'div')
    table.set(box, style({ backgroundColor: 'rgb(13, 17, 23)', color: 'rgb(255, 255, 255)' }))

    engine.enqueueTree(makeRoot(box, [box]))
    scheduler.runAll()
    assert.equal(recorder.writes().length, 2)

    engine.applyPointerTarget(box) // same values again
    assert.equal(recorder.writes().length, 2)
})

test('perf lock: an unchanged pseudo rule is not emitted twice', () => {
    const { recorder, engine, scheduler, table, css } = setup()
    const btn = el(recorder, 'a')
    table.set(btn, style({ color: 'rgb(255, 255, 255)' }))
    btn._pseudo = { '::after': style({ backgroundColor: 'rgb(22, 23, 29)' }) }

    engine.enqueueTree(makeRoot(btn, [btn]))
    scheduler.runAll()
    assert.equal(css.length, 1)

    // a class toggle re-plans the same element through the drain: the
    // generated rule is byte-identical, so nothing is appended
    table.set(btn, style({ backgroundColor: 'rgb(13, 17, 23)', color: 'rgb(255, 255, 255)' }))
    engine.enqueueMutations([{ type: 'attributes', target: btn, addedNodes: [] }])
    scheduler.runAll()
    assert.equal(css.length, 1)
})

test('STYLE_TEXT carries the color-only rules', () => {
    assert.match(Engine.STYLE_TEXT, /color-scheme:\s*light/)
    assert.match(Engine.STYLE_TEXT, /scrollbar-color:\s*#000 #fff/)
    assert.match(Engine.STYLE_TEXT, /::selection\s*{[^}]*background-color:\s*#000/)
    assert.match(Engine.STYLE_TEXT, /::selection\s*{[^}]*color:\s*#fff/)
    assert.doesNotMatch(Engine.STYLE_TEXT, /width|margin|padding/)
})

test('CONTRAST style: black text everywhere, no blanket background on real elements', () => {
    // the real-element rule forces only text — backgrounds are per element
    assert.match(Engine.CONTRAST_TEXT, /\*:not\(#eink\):not\(#eink\):not\(#eink\)\s*{[^}]*color:\s*#000 !important/)
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /\*:not\(#eink\):not\(#eink\):not\(#eink\)\s*{[^}]*background/)
    // the root stays white: transparent chains fall through to it
    assert.match(Engine.CONTRAST_TEXT, /html\s*{[^}]*background:\s*#fff !important/)
    // pseudo backgrounds are per element too — the blanket white erased
    // GitHub's selected-tab underline (github.com nav), so the stylesheet
    // must not set any background on ::before/::after
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /::after\s*{[^}]*background/)
    assert.match(Engine.CONTRAST_TEXT, /::before,\s*\*:not\(#eink\):not\(#eink\):not\(#eink\)::after\s*{[^}]*color:\s*#000 !important/)
    assert.match(Engine.CONTRAST_TEXT, /color-scheme:\s*light/)
    // the forced palette also covers selection and scrollbars — same rules
    // as auto mode's STYLE_TEXT
    assert.match(Engine.CONTRAST_TEXT, /::selection\s*{[^}]*background-color:\s*#000/)
    assert.match(Engine.CONTRAST_TEXT, /scrollbar-color:\s*#000 #fff/)
    // white glyph paint / placeholder / native accents cannot survive either
    assert.match(Engine.CONTRAST_TEXT, /-webkit-text-fill-color:\s*#000 !important/)
    assert.match(Engine.CONTRAST_TEXT, /::placeholder\s*{[^}]*color:\s*#000 !important/)
    assert.match(Engine.CONTRAST_TEXT, /accent-color:\s*#000 !important/)
    // media keeps its own colors — grayscaling it buys nothing on e-ink
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /grayscale|filter/)
    // transparent borders are intentional (spacing tricks) — never forced black
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /border-color/)
    // shadows survive contrast mode; the pass blackens the colored ones
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /box-shadow/)
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /invert/)
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /width:|margin:|padding:/) // color-only, no layout
})

test('CONTRAST style: hover/focus/active go white — a dark site hover paint can never return', () => {
    const s = '\\*:not\\(#eink\\):not\\(#eink\\):not\\(#eink\\)'
    // one rule for every interaction state; the one-shot contrast pass never
    // sees the hover moment, so the stylesheet must cover it
    assert.match(Engine.CONTRAST_TEXT, new RegExp(
        s + ':hover,\\s*'
        + s + ':focus,\\s*'
        + s + ':focus-visible,\\s*'
        + s + ':active\\s*{\\s*background:\\s*#fff !important;\\s*}'))
})

test('hover: transition delay counts into the re-check time', () => {
    const { recorder, engine, scheduler, table, delays } = setup()
    const link = el(recorder, 'a')
    table.set(link, style({
        color: 'rgb(255, 255, 255)',
        transitionProperty: 'color',
        transitionDuration: '0.2s',
        transitionDelay: '0.5s'
    }))

    engine.enqueueTree(makeRoot(link, [link]))
    scheduler.runAll()
    engine.applyPointerTarget(link)

    assert.equal(delays.length, 1)
    assert.equal(delays[0].ms, 730) // 200ms duration + 500ms delay + 30ms grace
})

test('hover: durations are matched per property, irrelevant ones ignored', () => {
    const { recorder, engine, scheduler, table, delays } = setup()
    const link = el(recorder, 'a')
    table.set(link, style({
        color: 'rgb(255, 255, 255)',
        transitionProperty: 'transform, color',
        transitionDuration: '5s, 0.2s'
    }))

    engine.enqueueTree(makeRoot(link, [link]))
    scheduler.runAll()
    engine.applyPointerTarget(link)

    assert.equal(delays.length, 1)
    assert.equal(delays[0].ms, 230) // color's 0.2s, not transform's 5s
})

test('transition re-check waits at most two seconds', () => {
    const { recorder, engine, scheduler, table, delays } = setup()
    const link = el(recorder, 'a')
    table.set(link, style({
        color: 'rgb(255, 255, 255)',
        transitionProperty: 'color',
        transitionDuration: '10s'
    }))

    engine.enqueueTree(makeRoot(link, [link]))
    scheduler.runAll()
    engine.applyPointerTarget(link)

    assert.equal(delays.length, 1)
    assert.equal(delays[0].ms, 2000)
})

test('a landed fix re-arms the element for future transition races', () => {
    const { recorder, engine, scheduler, table, delays } = setup()
    const link = el(recorder, 'a')
    // gray at load: kept, nothing written, no race armed
    table.set(link, style({ color: 'rgb(152, 152, 159)', transitionProperty: 'color', transitionDuration: '0.25s' }))
    engine.enqueueTree(makeRoot(link, [link]))
    scheduler.runAll()

    // first hover: reads gray (transition start) → arms the re-check
    engine.applyPointerTarget(link)
    assert.equal(delays.length, 1)

    // the hover color lands → the re-check writes the fix (clearing the arm)
    table.set(link, style({ color: 'rgb(255, 255, 255)', transitionProperty: 'color', transitionDuration: '0.25s' }))
    delays[0].fn()
    scheduler.runAll()
    assert.deepEqual(recorder.props(link), { color: '#000' })

    // a second race on the same element arms again
    table.set(link, style({ color: 'rgb(152, 152, 159)', transitionProperty: 'color', transitionDuration: '0.25s' }))
    engine.applyPointerTarget(link)
    assert.equal(delays.length, 2)

    // and once the fix is in, no more timers stack up
    delays[1].fn()
    scheduler.runAll()
    engine.applyPointerTarget(link)
    assert.equal(delays.length, 2)
})

test('form change on a detached control is a safe no-op', () => {
    const { recorder, engine, scheduler } = setup()
    const lone = el(recorder, 'input') // no parentElement

    engine.applyFormChange(lone)

    assert.equal(scheduler.frames.length, 0)
    assert.equal(recorder.reads().length, 0)
})

test('attribute changes on skipped tags schedule nothing', () => {
    const { recorder, engine, scheduler } = setup()
    const script = el(recorder, 'script')

    engine.enqueueMutations([{ type: 'attributes', target: script, addedNodes: [] }])

    assert.equal(scheduler.frames.length, 0)
    assert.equal(recorder.reads().length, 0)
})

test('a changed pseudo rule is appended after its identical predecessor is skipped', () => {
    const { recorder, engine, scheduler, table, css } = setup()
    const btn = el(recorder, 'a')
    table.set(btn, style({ color: 'rgb(255, 255, 255)' }))
    btn._pseudo = { '::after': style({ backgroundColor: 'rgb(22, 23, 29)' }) }
    engine.enqueueTree(makeRoot(btn, [btn]))
    scheduler.runAll()
    assert.equal(css.length, 1)

    // the overlay gains white text: the rule text differs, so a new rule lands
    btn._pseudo['::after'] = style({ backgroundColor: 'rgb(22, 23, 29)', color: 'rgb(255, 255, 255)' })
    engine.enqueueMutations([{ type: 'attributes', target: btn, addedNodes: [] }])
    scheduler.runAll()

    assert.equal(css.length, 2)
    assert.match(css[1], /color:#000!important/)
})

// ---- Mode B contrast pass: painted backgrounds go white, colored borders and shadows go black, the rest stay ----

function borderSetup() {
    const recorder = createRecorder()
    const table = new Map()
    const scheduler = createScheduler()
    const css = [] // generated pseudo rules, appended text like inject.js
    const pass = Engine.createContrastPass(C, {
        styles: createStyles(recorder, table),
        schedule: scheduler.schedule,
        applyCss: text => css.push(text)
    })
    return { recorder, scheduler, table, pass, css }
}

test('backgrounds: painted ones go white, transparent ones stay clear', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const dark = el(recorder, 'div')
    const overlay = el(recorder, 'div')   // translucent dark overlay: still a paint
    const gradient = el(recorder, 'div')  // gradient without a base color
    const clear = el(recorder, 'div')     // the style() default: fully transparent
    table.set(dark, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    table.set(overlay, style({ backgroundColor: 'rgba(0, 0, 0, 0.4)' }))
    table.set(gradient, style({ backgroundImage: 'linear-gradient(rgb(20, 20, 20), rgb(40, 40, 40))' }))

    pass.scanTree(makeRoot(dark, [dark, overlay, gradient, clear]))
    scheduler.runAll()

    // the shorthand write also clears images/gradients on painted elements
    assert.deepEqual(recorder.props(dark), { background: '#fff' })
    assert.deepEqual(recorder.props(overlay), { background: '#fff' })
    assert.deepEqual(recorder.props(gradient), { background: '#fff' })
    assert.deepEqual(recorder.props(clear), {}) // no background forced on clear elements
    assert.equal(recorder.writes().filter(w => w[1] === clear).length, 0)
})

test('backgrounds: a clear element keeps its transparency even when its border is blackened', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const box = el(recorder, 'div')
    table.set(box, style({ borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)' }))

    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(box), { 'border-top-color': '#000' })
})

test('backgrounds: open shadow roots are walked, painted ones whiten there too', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const host = el(recorder, 'div')
    const inner = el(recorder, 'div')
    table.set(inner, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    host.shadowRoot = { querySelectorAll: () => [inner] }

    pass.scanTree(makeRoot(host, [host]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(inner), { background: '#fff' })
})

test('pseudos: a painted accent indicator turns black, not white', () => {
    // GitHub's selected-tab underline: .UnderlineNav-item::after paints the
    // accent color — blanketing pseudo backgrounds white made it vanish
    const { recorder, scheduler, table, pass, css } = borderSetup()
    const item = el(recorder, 'a', {
        pseudo: { '::after': style({ content: '""', backgroundColor: 'rgb(253, 140, 115)' }) }
    })

    pass.scanTree(makeRoot(item, [item]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(item), {}) // the item itself stays clear
    assert.equal(item.attrs['data-eink-p'], '1')
    assert.deepEqual(css, ['[data-eink-p="1"]::after{background:#000!important}'])
})

test('pseudos: a url() photo fill goes white, a gradient goes black', () => {
    const { recorder, scheduler, table, pass, css } = borderSetup()
    const photo = el(recorder, 'div', {
        pseudo: { '::before': style({ content: '""', backgroundImage: 'url("https://x/hero.png")' }) }
    })
    const gradient = el(recorder, 'div', {
        pseudo: { '::after': style({ content: '""', backgroundImage: 'linear-gradient(rgb(20, 20, 20), rgb(40, 40, 40))' }) }
    })

    pass.scanTree(makeRoot(photo, [photo, gradient]))
    scheduler.runAll()

    assert.deepEqual(css, [
        '[data-eink-p="1"]::before{background:#fff!important}',
        '[data-eink-p="2"]::after{background:#000!important}'
    ])
})

test('pseudos: transparent or content-less pseudos get no rule and no hook attribute', () => {
    const { recorder, scheduler, table, pass, css } = borderSetup()
    const clearPseudo = el(recorder, 'div', {
        pseudo: { '::after': style({ content: '""' }) } // default: transparent
    })
    const noContent = el(recorder, 'div', {
        pseudo: { '::before': style({ content: 'none', backgroundColor: 'rgb(0, 0, 0)' }) }
    })

    pass.scanTree(makeRoot(clearPseudo, [clearPseudo, noContent]))
    scheduler.runAll()

    assert.deepEqual(css, [])
    assert.equal(clearPseudo.attrs['data-eink-p'], undefined)
    assert.equal(noContent.attrs['data-eink-p'], undefined)
    assert.equal(recorder.writes().length, 0)
})

test('hairlines: GitHub nav inset shadow blackens in place and stays visible', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const nav = el(recorder, 'nav')
    table.set(nav, style({ boxShadow: 'rgba(209, 217, 224, 0.7) 0px -1px 0px 0px inset' }))

    pass.scanTree(makeRoot(nav, [nav]))
    scheduler.runAll()

    // alpha kept (soft shadows stay soft), hue blackened — visible on white
    assert.deepEqual(recorder.props(nav), { 'box-shadow': 'rgba(0, 0, 0, 0.7) 0px -1px 0px 0px inset' })
})

test('text: white glyph paints the stylesheet lost go black inline, mid grays keep their paint', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    // shadow-root button (the wildcard never matches inside) and a stubborn
    // site rule that beat it (ID + !important) — same failure, same fix
    const shadowBtn = el(recorder, 'button')
    const stubborn = el(recorder, 'button')
    const muted = el(recorder, 'button')
    const field = el(recorder, 'input')
    table.set(shadowBtn, style({ color: 'rgb(255, 255, 255)', webkitTextFillColor: 'rgb(255, 255, 255)' }))
    table.set(stubborn, style({ color: 'rgb(255, 255, 255)' }))
    table.set(muted, style({ color: 'rgb(153, 153, 153)' }))
    table.set(field, style({ color: 'rgb(255, 255, 255)', caretColor: 'rgb(255, 255, 255)' }))

    pass.scanTree(makeRoot(shadowBtn, [shadowBtn, stubborn, muted, field]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(shadowBtn), { color: '#000', '-webkit-text-fill-color': '#000' })
    assert.deepEqual(recorder.props(stubborn), { color: '#000' })
    assert.deepEqual(recorder.props(muted), {}) // gray reads fine on white
    assert.deepEqual(recorder.props(field), { color: '#000', 'caret-color': '#000' })
})

test('reads: media and form controls skip the pseudo reads', () => {
    const { recorder, scheduler, pass } = borderSetup()
    const img = el(recorder, 'img')
    const field = el(recorder, 'input')
    const box = el(recorder, 'div')

    pass.scanTree(makeRoot(img, [img, field, box]))
    scheduler.runAll()

    assert.equal(recorder.reads().filter(r => r[1] === img).length, 1)
    assert.equal(recorder.reads().filter(r => r[1] === field).length, 1)
    assert.equal(recorder.reads().filter(r => r[1] === box).length, 3) // element + both pseudos
})

test('svg: white fills follow the text color instead of vanishing, non-shapes stay skipped', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const svg = el(recorder, 'svg') // icon sets hang fill on the root itself
    const icon = el(recorder, 'path', { parent: svg, ownerSvg: svg })
    const defs = el(recorder, 'defs', { parent: svg, ownerSvg: svg })
    table.set(svg, style({ fill: 'rgb(255, 255, 255)' }))
    table.set(icon, style({ fill: 'rgb(255, 255, 255)', stroke: 'rgb(255, 255, 255)' }))

    pass.scanTree(makeRoot(svg, [svg, icon, defs]))
    scheduler.runAll()

    // light paint was designed against a dark site: follow the forced black
    assert.deepEqual(recorder.props(svg), { fill: 'currentColor' })
    assert.deepEqual(recorder.props(icon), { fill: 'currentColor', stroke: 'currentColor' })
    assert.equal(recorder.writes().filter(w => w[1] === defs).length, 0)
})

test('class churn: newly painted elements whiten, un-painted ones drop the stale white', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const box = el(recorder, 'div')
    table.set(box, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()
    assert.deepEqual(recorder.props(box), { background: '#fff' })

    // theme toggle: the same element goes back to transparent — the stale
    // inline white must be removed, not frozen in place
    table.set(box, style())
    pass.onMutations([{ type: 'attributes', target: box, addedNodes: [] }])
    scheduler.runAll()
    assert.deepEqual(recorder.props(box), {})
    assert.ok(recorder.removals().some(r => r[1] === box && r[2] === 'background'))
})

test('form change: a sibling painted by :checked after load is re-read', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const parent = el(recorder, 'div')
    const input = el(recorder, 'input', { parent })
    const label = el(recorder, 'label', { parent })
    pass.scanTree(makeRoot(parent, [parent, input, label]))
    scheduler.runAll()
    assert.deepEqual(recorder.props(label), {}) // unchecked: transparent

    // input:checked + label { background: ... } lands with the commit
    table.set(label, style({ backgroundColor: 'rgb(13, 17, 23)' }))
    pass.applyFormChange(input)
    scheduler.runAll()
    assert.deepEqual(recorder.props(label), { background: '#fff' })
})

test('pseudos: an indicator un-painted by a class change gets a reset rule', () => {
    const { recorder, scheduler, table, pass, css } = borderSetup()
    const item = el(recorder, 'a', {
        pseudo: { '::after': style({ content: '""', backgroundColor: 'rgb(253, 140, 115)' }) }
    })
    pass.scanTree(makeRoot(item, [item]))
    scheduler.runAll()
    assert.deepEqual(css, ['[data-eink-p="1"]::after{background:#000!important}'])

    // the site drops the accent (tab deselected): the old black rule must
    // not stick — the sheet is append-only, so a later reset rule wins
    item._pseudo['::after'] = style({ content: '""' })
    pass.onMutations([{ type: 'attributes', target: item, addedNodes: [] }])
    scheduler.runAll()
    assert.deepEqual(css, [
        '[data-eink-p="1"]::after{background:#000!important}',
        '[data-eink-p="1"]::after{background:none!important}'
    ])
})

test('borders: opaque colored sides go black, every side on its own', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const box = el(recorder, 'div')
    table.set(box, style({
        borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)',
        borderRightWidth: '1px', borderRightColor: 'rgb(255, 255, 255)',
        borderBottomWidth: '8px', borderBottomColor: 'rgb(51, 51, 51)',
        borderLeftWidth: '1px', borderLeftColor: 'rgb(255, 255, 255)'
    }))

    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(box), {
        'border-top-color': '#000',
        'border-right-color': '#000',
        'border-bottom-color': '#000', // dark but colored: still forced black
        'border-left-color': '#000'
    })
})

test('borders: the transparent spacing trick is left untouched', () => {
    // Google's search box: a fat transparent border used purely as spacing
    const { recorder, scheduler, table, pass } = borderSetup()
    const box = el(recorder, 'div')
    table.set(box, style({
        borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)',
        borderBottomWidth: '8px', borderBottomColor: 'rgba(0, 0, 0, 0)'
    }))

    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(box), { 'border-top-color': '#000' })
})

test('borders: faint translucent sides read as decorative and stay', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const box = el(recorder, 'div')
    table.set(box, style({
        borderTopWidth: '1px', borderTopColor: 'rgba(255, 255, 255, 0.05)',
        borderBottomWidth: '1px', borderBottomColor: 'rgba(255, 255, 255, 0.6)'
    }))

    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(box), { 'border-bottom-color': '#000' })
})

test('borders: zero-width borders mean nothing to paint, nothing written', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const box = el(recorder, 'div')
    table.set(box, style({
        borderTopWidth: '0px', borderTopColor: 'rgb(255, 255, 255)',
        borderLeftWidth: '0px', borderLeftColor: 'rgb(255, 255, 255)'
    }))

    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()

    assert.equal(recorder.reads().length, 3) // element + both pseudos, once each
    assert.equal(recorder.writes().length, 0)
})

test('borders: batched like the engine, reads before writes, one frame at a time', () => {
    const recorder = createRecorder()
    const table = new Map()
    const scheduler = createScheduler()
    const pass = Engine.createContrastPass(C, {
        styles: createStyles(recorder, table),
        schedule: scheduler.schedule,
        batchSize: 2
    })
    const boxes = []
    for (let i = 0; i < 5; i++) {
        const box = el(recorder, 'div')
        table.set(box, style({ borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)' }))
        boxes.push(box)
    }

    pass.scanTree(makeRoot(boxes[0], boxes))
    assert.equal(scheduler.frames.length, 1)

    scheduler.runFrame()
    assert.equal(recorder.writes().length, 2)
    assert.equal(scheduler.frames.length, 1)

    scheduler.runFrame()
    scheduler.runFrame()
    assert.equal(recorder.writes().length, 5)
    assert.equal(scheduler.frames.length, 0)
})

test('borders: nodes added later are scanned, skipped tags are not', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const added = el(recorder, 'div')
    const child = el(recorder, 'p', { parent: added })
    const script = el(recorder, 'script', { parent: added })
    table.set(added, style({ borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)' }))
    table.set(child, style({ borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)' }))
    table.set(script, style({ borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)' }))

    pass.onMutations([{ addedNodes: [makeRoot(added, [child, script])] }])
    assert.equal(scheduler.frames.length, 1)
    scheduler.runAll()

    assert.deepEqual(recorder.props(added), { 'border-top-color': '#000' })
    assert.deepEqual(recorder.props(child), { 'border-top-color': '#000' })
    assert.equal(recorder.writes().filter(w => w[1] === script).length, 0)
})

test('borders: an element is inspected exactly once even when scanned twice', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const box = el(recorder, 'div')
    table.set(box, style({ borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)' }))

    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()
    const readsAfterFirst = recorder.reads().length

    pass.scanTree(makeRoot(box, [box]))
    scheduler.runAll()

    assert.equal(recorder.reads().length, readsAfterFirst)
})

test('shadows: colored ones turn black in place, black ones and none stay', () => {
    // borderless cards — the shadow alone gets them scanned
    const { recorder, scheduler, table, pass } = borderSetup()
    const glow = el(recorder, 'div')
    const soft = el(recorder, 'div')
    const plain = el(recorder, 'div')
    table.set(glow, style({ boxShadow: 'rgb(59, 130, 246) 0px 4px 12px 0px' }))
    table.set(soft, style({ boxShadow: 'rgba(59, 130, 246, 0.3) 0px 4px 12px 0px' }))
    table.set(plain, style({ boxShadow: 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px' }))

    pass.scanTree(makeRoot(glow, [glow, soft, plain]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(glow), { 'box-shadow': '#000 0px 4px 12px 0px' })
    assert.deepEqual(recorder.props(soft), { 'box-shadow': 'rgba(0, 0, 0, 0.3) 0px 4px 12px 0px' }) // alpha kept
    assert.deepEqual(recorder.props(plain), {}) // already black: nothing to write
})

test('shadows: borders and shadows on one element are fixed together', () => {
    const { recorder, scheduler, table, pass } = borderSetup()
    const card = el(recorder, 'div')
    table.set(card, style({
        borderTopWidth: '1px', borderTopColor: 'rgb(255, 255, 255)',
        boxShadow: 'rgb(59, 130, 246) 0px 4px 12px 0px'
    }))

    pass.scanTree(makeRoot(card, [card]))
    scheduler.runAll()

    assert.deepEqual(recorder.props(card), {
        'border-top-color': '#000',
        'box-shadow': '#000 0px 4px 12px 0px'
    })
})

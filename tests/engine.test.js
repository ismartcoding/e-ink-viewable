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
        borderColor: 'rgb(0, 0, 0)',
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
    assert.deepEqual(recorder.props(h1), {}) // white text stays readable on the photo
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

test('CONTRAST style: forces white backgrounds with black text everywhere', () => {
    assert.match(Engine.CONTRAST_TEXT, /\*[^{]*{[^}]*background-color:\s*#fff !important/)
    assert.match(Engine.CONTRAST_TEXT, /color:\s*#000 !important/)
    assert.match(Engine.CONTRAST_TEXT, /border-color:\s*#000 !important/)
    assert.match(Engine.CONTRAST_TEXT, /color-scheme:\s*light/)
    assert.match(Engine.CONTRAST_TEXT, /grayscale\(1\)/) // media goes grayscale too
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /invert/)
    assert.doesNotMatch(Engine.CONTRAST_TEXT, /width:|margin:|padding:/) // color-only, no layout
})

const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../src/color.js')
const Engine = require('../src/engine.js')
const { createRecorder, createStyles, makeRoot, createScheduler } = require('./fake-dom.js')

function setup(overrides = {}) {
    const recorder = createRecorder()
    const table = overrides.computed || new Map()
    const scheduler = createScheduler()
    const engine = Engine.createEngine(C, {
        styles: createStyles(recorder, table),
        schedule: scheduler.schedule,
        batchSize: overrides.batchSize
    })
    return { recorder, scheduler, engine, table }
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
    const { recorder, engine, scheduler } = setup()
    const root = el(recorder, 'div')
    const script = el(recorder, 'script', { parent: root })
    const styleEl = el(recorder, 'style', { parent: root })
    const svgDefs = el(recorder, 'defs', { parent: root, ownerSvg: root })
    const svgFilter = el(recorder, 'feGaussianBlur', { parent: root, ownerSvg: root })
    const textNode = { nodeType: 3, parentElement: root }
    root.querySelectorAll = () => [script, styleEl, svgDefs, svgFilter, textNode]

    engine.enqueueTree(root)
    scheduler.runAll()

    // only the (non-skipped) root itself is processed
    assert.equal(recorder.reads().length, 1)
    assert.ok(recorder.reads().every(e => e[1] === root))
    assert.equal(recorder.writes().length, 0)
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

    assert.equal(recorder.reads().length, 1)
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

    // target + 31 ancestors = 32 reads for the hover pass
    const hoverReads = recorder.reads().length - 2 // minus the 2 load-pass reads
    assert.equal(hoverReads, 32)
})

test('STYLE_TEXT carries the color-only rules', () => {
    assert.match(Engine.STYLE_TEXT, /color-scheme:\s*light/)
    assert.match(Engine.STYLE_TEXT, /scrollbar-color:\s*#000 #fff/)
    assert.match(Engine.STYLE_TEXT, /::selection\s*{[^}]*background-color:\s*#000/)
    assert.match(Engine.STYLE_TEXT, /::selection\s*{[^}]*color:\s*#fff/)
    assert.doesNotMatch(Engine.STYLE_TEXT, /width|margin|padding/)
})

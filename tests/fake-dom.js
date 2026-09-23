// Minimal fake DOM for driving src/engine.js without a browser.
// Elements are plain objects recording every style write into a shared log.

function createRecorder() {
    const log = []
    const recorder = {
        log,
        reads: () => log.filter(e => e[0] === 'read'),
        writes: () => log.filter(e => e[0] === 'write'),
        props: el => Object.fromEntries(log.filter(e => e[0] === 'write' && e[1] === el).map(e => [e[2], e[3]])),
        // opts: { parent, contentEditable, ownerSvg }
        el(tag, opts = {}) {
            const el = {
                nodeType: 1,
                tagName: tag.toUpperCase(),
                parentElement: opts.parent || null,
                ownerSVGElement: opts.ownerSvg || null,
                isContentEditable: !!opts.contentEditable,
                style: {
                    setProperty(prop, value) {
                        log.push(['write', el, prop, value])
                    }
                }
            }
            return el
        }
    }
    return recorder
}

// Computed-style lookup table + recording wrapper for the engine's `styles` dep.
function createStyles(recorder, table) {
    return el => {
        recorder.log.push(['read', el])
        return table.get(el) || {}
    }
}

// A tree root: engine.enqueueTree walks querySelectorAll('*').
function makeRoot(el, descendants) {
    el.querySelectorAll = () => descendants
    return el
}

// Scheduler the tests drive by hand: each frame callback lands in `frames`.
function createScheduler() {
    const frames = []
    return {
        frames,
        schedule: callback => frames.push(callback),
        runFrame() {
            const callback = frames.shift()
            if (callback) callback()
            return !!callback
        },
        runAll() {
            while (this.runFrame()) { /* drain */ }
        }
    }
}

module.exports = { createRecorder, createStyles, makeRoot, createScheduler }

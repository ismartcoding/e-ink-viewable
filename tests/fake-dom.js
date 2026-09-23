// Minimal fake DOM for driving src/engine.js without a browser.
// Elements are plain objects recording every style write into a shared log.

function createRecorder() {
    const log = []
    const recorder = {
        log,
        reads: () => log.filter(e => e[0] === 'read'),
        writes: () => log.filter(e => e[0] === 'write'),
        props: el => Object.fromEntries(log.filter(e => e[0] === 'write' && e[1] === el).map(e => [e[2], e[3]])),
        // opts: { parent, contentEditable, ownerSvg, pseudo: {'::before': {...}, '::after': {...}} }
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
                },
                attrs: {},
                setAttribute(name, value) {
                    el.attrs[name] = value
                },
                getAttribute(name) {
                    return el.attrs[name] !== undefined ? el.attrs[name] : null
                }
            }
            if (opts.pseudo) el._pseudo = opts.pseudo
            return el
        }
    }
    return recorder
}

// Computed-style lookup: element styles via the element, pseudo styles via
// opts.pseudo. Every lookup is recorded so tests can assert read ordering.
function createStyles(recorder, table) {
    return (el, pseudo) => {
        recorder.log.push(['read', el, pseudo || ''])
        if (pseudo) return (el._pseudo && el._pseudo[pseudo]) || {}
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

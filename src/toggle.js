// Per-site and global ink-style pause state, storage-backed.
//
// Storage model: 'i:<host>' = 1 pauses one site, 'p:all' = 1 pauses every
// site; anything unset means the ink style applies. All decisions live here
// so tests can drive them on an in-memory storage; callers inject the
// chrome.storage area objects.

const SITE_PREFIX = 'i:'
const GLOBAL_KEY = 'p:all'

function siteKey(url) {
    return SITE_PREFIX + new URL(url).host
}

function isWebUrl(url) {
    return /^https?:/i.test(String(url || ''))
}

function createToggleService({ storage }) {
    async function pausedFor(url) {
        const key = siteKey(url)
        const items = await storage.local.get(key)
        return !!items[key]
    }

    // null = the ink style never runs here (not a web page).
    async function getState(url) {
        if (!isWebUrl(url)) return null
        return pausedFor(url)
    }

    // Flips the per-site flag and returns the new paused state.
    async function toggle(url) {
        if (!isWebUrl(url)) return null
        const key = siteKey(url)
        const items = await storage.local.get(key)
        const paused = !!items[key]
        const value = paused ? 0 : 1
        await storage.local.set({ [key]: value })
        return { paused: !!value }
    }

    async function getGlobal() {
        const items = await storage.local.get(GLOBAL_KEY)
        return !!items[GLOBAL_KEY]
    }

    async function setGlobal(paused) {
        await storage.local.set({ [GLOBAL_KEY]: paused ? 1 : 0 })
    }

    // One-time carry of per-site flags from the old sync backend.
    // Returns how many keys were migrated.
    async function migrateSync() {
        const all = (await storage.sync.get(null)) || {}
        const old = {}
        for (const key of Object.keys(all)) {
            if (key.startsWith(SITE_PREFIX)) old[key] = all[key]
        }
        if (Object.keys(old).length) await storage.local.set(old)
        return Object.keys(old).length
    }

    return { pausedFor, getState, toggle, getGlobal, setGlobal, migrateSync }
}

const Toggle = { GLOBAL_KEY, SITE_PREFIX, siteKey, isWebUrl, createToggleService }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Toggle
} else {
    globalThis.Toggle = Toggle
}

// Per-site and global ink-style mode, storage-backed.
//
// Storage model:
// - 'i:<host>' — this site's mode override: 'auto' | 'contrast' | 'off';
//   absent = follow the default. 'off' is stored explicitly so it can
//   override a non-off default.
// - 'd:all' — the default every site follows when it has no override;
//   absent = 'auto'. Set from the popup's settings panel.
// - 'l:<host>' — the last non-off mode chosen on this site, for the
//   keyboard shortcut's off→on flip.
//
// All decisions live here so tests can drive them on an in-memory storage;
// callers inject the chrome.storage area objects.

const SITE_PREFIX = 'i:'
const LAST_PREFIX = 'l:'
const DEFAULT_KEY = 'd:all'
const MODES = ['auto', 'contrast', 'off']

function siteKey(url) {
    return SITE_PREFIX + new URL(url).host
}

function lastKey(url) {
    return LAST_PREFIX + new URL(url).host
}

function isWebUrl(url) {
    return /^https?:/i.test(String(url || ''))
}

function normalizeMode(mode) {
    return MODES.includes(mode) ? mode : null
}

function createToggleService({ storage }) {
    // The mode a site runs in: its own override, else the default, else 'auto'.
    // null = not a web page, the mode never runs there.
    async function getSiteMode(url) {
        if (!isWebUrl(url)) return null
        const items = await storage.local.get([siteKey(url), DEFAULT_KEY])
        return normalizeMode(items[siteKey(url)]) || normalizeMode(items[DEFAULT_KEY]) || 'auto'
    }

    // Writes the site's override. Non-off modes are also remembered so the
    // shortcut can restore them.
    async function setSiteMode(url, mode) {
        if (!isWebUrl(url) || !normalizeMode(mode)) return null
        const items = { [siteKey(url)]: mode }
        if (mode !== 'off') items[lastKey(url)] = mode
        await storage.local.set(items)
        return mode
    }

    async function getDefaultMode() {
        const items = await storage.local.get(DEFAULT_KEY)
        return normalizeMode(items[DEFAULT_KEY]) || 'auto'
    }

    async function setDefaultMode(mode) {
        if (!normalizeMode(mode)) return null
        await storage.local.set({ [DEFAULT_KEY]: mode })
        return mode
    }

    // Keyboard shortcut: off ↔ whatever this site last used (else the
    // default, when it isn't off, else 'auto').
    async function toggleShortcut(url) {
        if (!isWebUrl(url)) return null
        const current = await getSiteMode(url)
        if (current !== 'off') {
            await storage.local.set({ [siteKey(url)]: 'off' })
            return 'off'
        }
        const items = await storage.local.get([lastKey(url), DEFAULT_KEY])
        const restore = normalizeMode(items[lastKey(url)]) ||
            (normalizeMode(items[DEFAULT_KEY]) !== 'off' ? normalizeMode(items[DEFAULT_KEY]) : null) ||
            'auto'
        await storage.local.set({ [siteKey(url)]: restore })
        return restore
    }

    return { getSiteMode, setSiteMode, getDefaultMode, setDefaultMode, toggleShortcut }
}

const Toggle = { SITE_PREFIX, DEFAULT_KEY, siteKey, isWebUrl, createToggleService }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Toggle
} else {
    globalThis.Toggle = Toggle
}

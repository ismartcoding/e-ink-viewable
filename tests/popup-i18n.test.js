const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const src = path.join(__dirname, '../src')

function popup({ browserLang = 'zh-CN', nativeMessage = () => '', failLocale = '', overrides = {} } = {}) {
    let options
    const requested = [], storage = {}
    const context = {
        chrome: {
            i18n: { getUILanguage: () => browserLang, getMessage: nativeMessage },
            storage: { local: { get: async () => storage, set: async items => Object.assign(storage, items) } },
            runtime: { getURL: relative => relative }
        },
        document: { documentElement: {}, getElementById: () => ({}), querySelectorAll: selector => selector === '#lang-select option' ? fs.readdirSync(path.join(src, '_locales')).map(value => ({ value })) : [], querySelector: () => ({}) },
        Toggle: { createToggleService: () => ({}) },
        PopupUi: { createPopupUi: value => { options = value; return { init() {} } } },
        fetch: async url => {
            const locale = url.split('/')[1]
            requested.push(locale)
            if (locale === failLocale) throw Error('Locale unavailable')
            return { ok: true, json: async () => overrides[locale] || JSON.parse(fs.readFileSync(path.join(src, url), 'utf8')) }
        }
    }
    vm.createContext(context)
    vm.runInContext(fs.readFileSync(path.join(src, 'popup.js'), 'utf8'), context)
    return { i18n: options.i18n, requested, storage }
}
const catalog = locale => JSON.parse(fs.readFileSync(path.join(src, `_locales/${locale}/messages.json`), 'utf8'))

test('follow browser renders every popup label even when native getMessage returns empty', async () => {
    const f = popup()
    const t = await f.i18n.load('')
    for (const [key, entry] of Object.entries(catalog('zh_CN'))) assert.equal(t(key), entry.message, key)
    assert.equal(await f.i18n.getSavedLang(), '')
})

test('manual choice then follow browser restores browser labels instead of blank strings', async () => {
    const f = popup({ browserLang: 'fr-CA' })
    await f.i18n.saveLang('ja')
    assert.equal((await f.i18n.load('ja'))('modeAuto'), catalog('ja').modeAuto.message)
    await f.i18n.saveLang('')
    const t = await f.i18n.load('')
    assert.equal(t('langAuto'), catalog('fr').langAuto.message)
    assert.equal(await f.i18n.getSavedLang(), '')
})

test('native browser translations remain preferred when available', async () => {
    const t = await popup({ nativeMessage: key => key === 'modeAuto' ? 'Native label' : '' }).i18n.load('')
    assert.equal(t('modeAuto'), 'Native label')
    assert.equal(t('modeOff'), catalog('zh_CN').modeOff.message)
})

for (const [language, locale] of [['zh-Hant-HK', 'zh_TW'], ['zh-Hans-SG', 'zh_CN'], ['pt-PT', 'pt_BR'], ['de-AT', 'de'], ['xx-YY', 'en']]) {
    test(`${language} follows the available packaged ${locale} catalog`, async () => {
        const t = await popup({ browserLang: language }).i18n.load('')
        assert.equal(t('modeAuto'), catalog(locale).modeAuto.message)
    })
}

test('failed or incomplete locale files fall back to packaged English per key', async () => {
    const failed = await popup({ failLocale: 'zh_CN' }).i18n.load('')
    assert.equal(failed('modeAuto'), catalog('en').modeAuto.message)
    const partial = await popup({ overrides: { ja: { modeAuto: { message: '   ' } } } }).i18n.load('ja')
    assert.equal(partial('modeAuto'), catalog('en').modeAuto.message)
    assert.equal(partial('langAuto'), catalog('en').langAuto.message)
})

test('all shipped browser locales keep complete labels when the native catalog is empty', async () => {
    for (const locale of fs.readdirSync(path.join(src, '_locales'))) {
        const t = await popup({ browserLang: locale.replace('_', '-') }).i18n.load('')
        for (const [key, entry] of Object.entries(catalog(locale))) assert.equal(t(key), entry.message, `${locale}/${key}`)
    }
})

test('a native translation exception still leaves usable popup labels', async () => {
    const t = await popup({ nativeMessage: () => { throw Error('Native catalog unavailable') } }).i18n.load('')
    assert.equal(t('modeAuto'), catalog('zh_CN').modeAuto.message)
})

test('real popup initialization and switching back to browser language never clear visible labels', async () => {
    const elements = new Map(), listeners = new WeakMap()
    const makeElement = () => {
        const el = { textContent: '', value: '', dataset: {}, classList: { toggle() {} },
            setAttribute(name, value) { this[name] = value }, addEventListener(name, callback) { listeners.get(this)[name] = callback } }
        listeners.set(el, {})
        return el
    }
    const get = id => { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id) }
    const buttons = () => ['auto', 'contrast', 'off'].map(mode => { const el = makeElement(); el.dataset.mode = mode; return el })
    const siteButtons = buttons(), defaultButtons = buttons()
    let ready
    const storage = {}, uiModule = require('../src/popup-ui')
    const context = {
        chrome: { i18n: { getUILanguage: () => 'zh-CN', getMessage: () => '' },
            storage: { local: { get: async () => storage, set: async items => Object.assign(storage, items) } },
            tabs: { query: async () => [{ id: 1, url: 'https://example.org/' }], sendMessage: async () => {} },
            runtime: { getURL: relative => relative } },
        document: { documentElement: get('root'), getElementById: get,
            querySelector: () => get('auto-option'),
            querySelectorAll: selector => selector === '#lang-select option' ? fs.readdirSync(path.join(src, '_locales')).map(value => ({ value }))
                : selector === '#site-modes button' ? siteButtons : defaultButtons },
        Toggle: require('../src/toggle'),
        PopupUi: { createPopupUi(options) { const ui = uiModule.createPopupUi(options); return { init() { ready = ui.init() } } } },
        fetch: async relative => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(src, relative), 'utf8')) })
    }
    vm.createContext(context)
    vm.runInContext(fs.readFileSync(path.join(src, 'popup.js'), 'utf8'), context)
    await ready
    const visible = ['app-title', 'enabled-label', 'site-label', 'lang-label', 'settings-title', 'settings-hint', 'shortcuts', 'promo']
    for (const id of visible) assert.ok(get(id).textContent.trim(), id)
    assert.deepEqual(siteButtons.map(b => b.textContent), ['舒适', '强对比', '关闭'])
    const select = get('lang-select')
    select.value = 'ja'; await listeners.get(select).change()
    assert.equal(siteButtons[0].textContent, catalog('ja').modeAuto.message)
    select.value = ''; await listeners.get(select).change()
    for (const id of visible) assert.ok(get(id).textContent.trim(), id)
    assert.deepEqual(siteButtons.map(b => b.textContent), ['舒适', '强对比', '关闭'])
    assert.equal(get('auto-option').textContent, '跟随浏览器')
    assert.equal(storage.lang, '')
})

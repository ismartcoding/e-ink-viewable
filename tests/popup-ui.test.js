const test = require('node:test')
const assert = require('node:assert/strict')
const Toggle = require('../src/toggle.js')
const PopupUi = require('../src/popup-ui.js')

// Real toggle service on fake storage + fake popup elements: behavior-level
// tests of what the user sees and what each click does.
function setup({ local = {}, activeUrl = 'https://a.com/page' } = {}) {
    const localData = { ...local }
    const service = Toggle.createToggleService({
        storage: {
            local: {
                async get(key) {
                    if (key === null) return { ...localData }
                    if (Array.isArray(key)) return Object.fromEntries(key.filter(k => k in localData).map(k => [k, localData[k]]))
                    return key in localData ? { [key]: localData[key] } : {}
                },
                async set(items) { Object.assign(localData, items) }
            }
        }
    })

    const clicks = {}
    const cap = s => s[0].toUpperCase() + s.slice(1)
    const makeButton = name => {
        const button = {
            dataset: {},
            disabled: false,
            textContent: '',
            attrs: {},
            classes: new Set(),
            classList: {
                toggle: (cls, on) => { on ? button.classes.add(cls) : button.classes.delete(cls) }
            },
            setAttribute: (name, value) => { button.attrs[name] = value },
            addEventListener: (type, handler) => { clicks[name] = handler }
        }
        return button
    }
    const el = {
        appTitle: { textContent: '' },
        siteLabel: { textContent: '' },
        langLabel: { textContent: '' },
        languageButtons: [['', 'langAuto'], ['en', 'langEn'], ['zh_CN', 'langZhCn']].map(([code, name]) => {
            const button = makeButton(name)
            button.dataset.lang = code
            return button
        }),
        siteModeButtons: ['auto', 'contrast', 'off'].map(mode => {
            const button = makeButton('seg' + cap(mode))
            button.dataset.mode = mode
            return button
        }),
        defaultModeButtons: ['auto', 'contrast', 'off'].map(mode => {
            const button = makeButton('default' + cap(mode))
            button.dataset.mode = mode
            return button
        }),
        settings: makeButton('settings'),
        settingsPanel: { hidden: true },
        settingsTitle: { textContent: '' },
        settingsHint: { textContent: '' },
        settingsTitle: { textContent: '' },
        settingsHint: { textContent: '' },
        help: makeButton('help'),
        helpPanel: { hidden: true },
        helpAuto: { textContent: '' },
        helpContrast: { textContent: '' },
        helpOff: { textContent: '' },
        helpDefault: { textContent: '' },
        shortcuts: makeButton('shortcuts'),
        promo: { textContent: '' }
    }

    // two real dictionaries behind a fake loader: '' falls back per key
    const messages = {
        '': {},
        zh_CN: { appName: '中文助手', modeAuto: '舒适', modeContrast: '强对比', modeOff: '关闭', langAuto: '跟随浏览器', langLabel: '语言' }
    }
    const i18n = {
        saved: '',
        async getSavedLang() { return this.saved },
        async saveLang(lang) { this.saved = lang },
        async load(lang) {
            const dict = messages[lang] || {}
            return key => dict[key] || 't:' + key
        }
    }

    const sent = []
    const opened = []
    const activeTab = activeUrl ? { id: 7, url: activeUrl } : null
    const ui = PopupUi.createPopupUi({
        service,
        i18n,
        getActiveTab: async () => activeTab,
        sendMessage: async (tabId, message) => { sent.push([tabId, message]) },
        openPage: url => opened.push(url),
        el
    })

    return { localData, el, clicks, sent, opened, ui, service, i18n }
}

const selected = button => button.classes.has('selected')

test('init: auto is selected everywhere, panels closed', async () => {
    const { el, ui } = setup()
    await ui.init()

    assert.equal(selected(el.siteModeButtons[0]), true)
    assert.equal(selected(el.defaultModeButtons[0]), true)
    assert.equal(el.siteModeButtons.every(b => !b.disabled), true)
    assert.equal(el.settingsPanel.hidden, true)
    assert.equal(el.helpPanel.hidden, true)
})

test('init: every visible text comes from the translate function', async () => {
    const { el, ui } = setup()
    await ui.init()

    assert.equal(el.appTitle.textContent, 't:appName')
    assert.equal(el.siteLabel.textContent, 't:thisSite')
    assert.equal(el.siteModeButtons[0].textContent, 't:modeAuto')
    assert.equal(el.siteModeButtons[1].textContent, 't:modeContrast')
    assert.equal(el.siteModeButtons[2].textContent, 't:modeOff')
    assert.equal(el.defaultModeButtons[1].textContent, 't:modeContrast')
    assert.equal(el.settingsTitle.textContent, 't:settingsTitle')
    assert.equal(el.settingsHint.textContent, 't:settingsHint')
    assert.equal(el.helpAuto.textContent, 't:helpAuto')
    assert.equal(el.helpContrast.textContent, 't:helpContrast')
    assert.equal(el.helpOff.textContent, 't:helpOff')
    assert.equal(el.helpDefault.textContent, 't:helpDefault')
    assert.equal(el.langLabel.textContent, 't:langLabel')
    assert.equal(el.languageButtons[0].textContent, 't:langAuto')
    assert.equal(el.languageButtons[1].textContent, 'English')
    assert.equal(el.languageButtons[2].textContent, '中文')
    assert.equal(el.shortcuts.textContent, 't:shortcutsLink')
    assert.equal(el.promo.textContent, 't:promoLine')
    assert.equal(el.settings.title, 't:settingsTooltip')
    assert.equal(el.settings.attrs['aria-label'], 't:settingsTooltip')
    assert.equal(el.help.title, 't:helpTooltip')
    assert.equal(el.help.attrs['aria-label'], 't:helpTooltip')
})

test('init: a per-site override selects its segment, default visible in settings', async () => {
    const { el, ui } = setup({ local: { 'i:a.com': 'contrast', 'd:all': 'off' } })
    await ui.init()

    assert.equal(selected(el.siteModeButtons[1]), true)   // site override: High contrast
    assert.equal(selected(el.defaultModeButtons[2]), true) // default: Off
})

test('init: non-web page disables the site segments', async () => {
    const { el, ui } = setup({ activeUrl: 'chrome://version' })
    await ui.init()

    assert.equal(el.siteModeButtons.every(b => b.disabled), true)
    assert.equal(selected(el.defaultModeButtons[0]), true) // default still usable
})

test('clicking High contrast stores it on this site and reloads the tab', async () => {
    const { el, clicks, localData, sent, ui } = setup()
    await ui.init()
    await clicks.segContrast()

    assert.equal(localData['i:a.com'], 'contrast')
    assert.equal(selected(el.siteModeButtons[1]), true)
    assert.deepEqual(sent, [[7, 'reload']])
})

test('the settings button toggles the settings panel', async () => {
    const { el, clicks, ui } = setup()
    await ui.init()

    await clicks.settings()
    assert.equal(el.settingsPanel.hidden, false)
    await clicks.settings()
    assert.equal(el.settingsPanel.hidden, true)
})

test('opening one panel closes the other', async () => {
    const { el, clicks, ui } = setup()
    await ui.init()

    await clicks.settings()
    await clicks.help()
    assert.equal(el.settingsPanel.hidden, true)
    assert.equal(el.helpPanel.hidden, false)
})

test('clicking a default mode stores it and reloads the tab', async () => {
    const { el, clicks, localData, sent, ui } = setup()
    await ui.init()
    await clicks.settings()
    await clicks.defaultContrast()

    assert.equal(localData['d:all'], 'contrast')
    assert.equal(selected(el.defaultModeButtons[1]), true)
    assert.deepEqual(sent, [[7, 'reload']])
})

test('the help button toggles the help panel', async () => {
    const { el, clicks, ui } = setup()
    await ui.init()

    await clicks.help()
    assert.equal(el.helpPanel.hidden, false)
    await clicks.help()
    assert.equal(el.helpPanel.hidden, true)
})

test('clicking Chinese switches every text and persists the choice', async () => {
    const { el, clicks, i18n, ui } = setup()
    await ui.init()
    await clicks.settings() // the language entry lives in the settings panel
    assert.equal(el.settingsPanel.hidden, false)

    await clicks.langZhCn()

    assert.equal(i18n.saved, 'zh_CN')
    assert.equal(el.appTitle.textContent, '中文助手')
    assert.equal(el.siteModeButtons[0].textContent, '舒适')
    assert.equal(el.languageButtons[2].classes.has('selected'), true)
    assert.equal(el.languageButtons[0].classes.has('selected'), false)
})

test('a saved language applies on init without any click', async () => {
    const { el, ui, i18n } = setup()
    i18n.saved = 'zh_CN'
    await ui.init()

    assert.equal(el.appTitle.textContent, '中文助手')
    assert.equal(el.siteModeButtons[0].textContent, '舒适')
    assert.equal(el.languageButtons[2].classes.has('selected'), true)
})

test('clicking Auto clears the manual choice', async () => {
    const { el, clicks, i18n, ui } = setup({ local: {} })
    i18n.saved = 'zh_CN'
    await ui.init()
    await clicks.settings()

    await clicks.langAuto()

    assert.equal(i18n.saved, '')
    assert.equal(el.appTitle.textContent, 't:appName') // back to browser language
    assert.equal(el.languageButtons[0].classes.has('selected'), true)
})

test('shortcuts link opens the Chrome shortcuts page', async () => {
    const { clicks, opened } = setup()
    let prevented = false
    clicks.shortcuts({ preventDefault: () => { prevented = true } })
    assert.deepEqual(opened, ['chrome://extensions/shortcuts'])
    assert.equal(prevented, true)
})

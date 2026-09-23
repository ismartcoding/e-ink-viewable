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
            classes: new Set(),
            classList: {
                toggle: (cls, on) => { on ? button.classes.add(cls) : button.classes.delete(cls) }
            },
            addEventListener: (type, handler) => { clicks[name] = handler }
        }
        return button
    }
    const el = {
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
        help: makeButton('help'),
        helpPanel: { hidden: true },
        shortcuts: makeButton('shortcuts')
    }

    const sent = []
    const opened = []
    const activeTab = activeUrl ? { id: 7, url: activeUrl } : null
    const ui = PopupUi.createPopupUi({
        service,
        getActiveTab: async () => activeTab,
        sendMessage: async (tabId, message) => { sent.push([tabId, message]) },
        openPage: url => opened.push(url),
        el
    })

    return { localData, el, clicks, sent, opened, ui, service }
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

test('init: a per-site override selects its segment, default visible in settings', async () => {
    const { el, ui } = setup({ local: { 'i:a.com': 'contrast', 'd:all': 'off' } })
    await ui.init()

    assert.equal(selected(el.siteModeButtons[1]), true)   // site override: 强对比
    assert.equal(selected(el.defaultModeButtons[2]), true) // default: 关闭
})

test('init: non-web page disables the site segments', async () => {
    const { el, ui } = setup({ activeUrl: 'chrome://version' })
    await ui.init()

    assert.equal(el.siteModeButtons.every(b => b.disabled), true)
    assert.equal(selected(el.defaultModeButtons[0]), true) // default still usable
})

test('clicking 强对比 stores it on this site and reloads the tab', async () => {
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

test('shortcuts link opens the Chrome shortcuts page', async () => {
    const { clicks, opened } = setup()
    let prevented = false
    clicks.shortcuts({ preventDefault: () => { prevented = true } })
    assert.deepEqual(opened, ['chrome://extensions/shortcuts'])
    assert.equal(prevented, true)
})

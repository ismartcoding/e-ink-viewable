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
                    return key in localData ? { [key]: localData[key] } : {}
                },
                async set(items) { Object.assign(localData, items) }
            }
        }
    })

    const clicks = {}
    const makeButton = name => ({
        textContent: '',
        disabled: undefined,
        addEventListener: (type, handler) => { clicks[name] = handler }
    })
    const el = {
        toggle: makeButton('toggle'),
        toggleAll: makeButton('toggleAll'),
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

async function click(button) {
    await button.clicks.toggle && button.clicks.toggle()
}

test('init: style applied on a light-state site', async () => {
    const { el, ui } = setup()
    await ui.init()
    assert.equal(el.toggle.textContent, 'Remove ink style')
    assert.equal(el.toggle.disabled, false)
    assert.equal(el.toggleAll.textContent, 'Pause on all sites')
})

test('init: paused site offers to apply the style again', async () => {
    const { el, ui } = setup({ local: { 'i:a.com': 1 } })
    await ui.init()
    assert.equal(el.toggle.textContent, 'Apply ink style')
    assert.equal(el.toggle.disabled, false)
})

test('init: non-web page disables the per-site button', async () => {
    const { el, ui } = setup({ activeUrl: 'chrome://version' })
    await ui.init()
    assert.equal(el.toggle.textContent, 'Not available on this page')
    assert.equal(el.toggle.disabled, true)
    // global pause still makes sense on any page
    assert.equal(el.toggleAll.disabled, undefined)
    assert.equal(el.toggleAll.textContent, 'Pause on all sites')
})

test('init: global pause resumes everywhere and disables the site button', async () => {
    const { el, ui } = setup({ local: { 'p:all': 1, 'i:a.com': 1 } })
    await ui.init()
    assert.equal(el.toggleAll.textContent, 'Resume on all sites')
    assert.equal(el.toggle.disabled, true)
    assert.equal(el.toggle.textContent, 'Apply ink style') // site state kept visible
})

test('clicking the site button pauses the site and reloads the tab', async () => {
    const { el, clicks, localData, sent, ui } = setup()
    await ui.init()
    await clicks.toggle()

    assert.equal(localData['i:a.com'], 1)
    assert.equal(el.toggle.textContent, 'Apply ink style')
    assert.deepEqual(sent, [[7, 'reload']])
})

test('clicking the site button again applies the style again', async () => {
    const { el, clicks, localData, sent, ui } = setup({ local: { 'i:a.com': 1 } })
    await ui.init()
    await clicks.toggle()

    assert.equal(localData['i:a.com'], 0)
    assert.equal(el.toggle.textContent, 'Remove ink style')
    assert.deepEqual(sent, [[7, 'reload']])
})

test('clicking the global button pauses all sites and reloads', async () => {
    const { el, clicks, localData, sent, ui } = setup()
    await ui.init()
    await clicks.toggleAll()

    assert.equal(localData['p:all'], 1)
    assert.equal(el.toggleAll.textContent, 'Resume on all sites')
    assert.equal(el.toggle.disabled, true)
    assert.deepEqual(sent, [[7, 'reload']])
})

test('clicking the global button again resumes everywhere', async () => {
    const { el, clicks, localData, ui } = setup({ local: { 'p:all': 1 } })
    await ui.init()
    await clicks.toggleAll()

    assert.equal(localData['p:all'], 0)
    assert.equal(el.toggleAll.textContent, 'Pause on all sites')
    assert.equal(el.toggle.disabled, false)
})

test('global toggle works on a non-web page too (reload failure is swallowed)', async () => {
    const { el, clicks, localData, sent, ui } = setup({ activeUrl: null })
    await ui.init()
    await clicks.toggleAll()

    assert.equal(localData['p:all'], 1)
    assert.equal(el.toggleAll.textContent, 'Resume on all sites')
    assert.deepEqual(sent, []) // no tab → no message, no crash
})

test('shortcuts link opens the Chrome shortcuts page', async () => {
    const { clicks, opened } = setup()
    let prevented = false
    clicks.shortcuts({ preventDefault: () => { prevented = true } })
    assert.deepEqual(opened, ['chrome://extensions/shortcuts'])
    assert.equal(prevented, true)
})

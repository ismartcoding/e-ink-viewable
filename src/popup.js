// The popup's language preference: '' follows the browser, or an explicit
// locale folder under _locales/. chrome.i18n always follows the browser, so
// a manual choice loads that locale's messages.json directly instead.

const i18n = {
    async getSavedLang() {
        const items = await chrome.storage.local.get('lang')
        return items.lang || ''
    },
    async saveLang(lang) {
        await chrome.storage.local.set({ lang })
    },
    async load(lang) {
        if (!lang) return key => chrome.i18n.getMessage(key)
        const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`)
        const messages = await (await fetch(url)).json()
        return key => (messages[key] && messages[key].message) || chrome.i18n.getMessage(key)
    }
}

const service = Toggle.createToggleService({
    storage: { local: chrome.storage.local }
})

const ui = PopupUi.createPopupUi({
    service,
    i18n,
    getActiveTab: async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        return (tabs && tabs[0]) || null
    },
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    openPage: url => chrome.tabs.create({ url }),
    el: {
        appTitle: document.getElementById('app-title'),
        siteLabel: document.getElementById('site-label'),
        siteModeButtons: [...document.querySelectorAll('#site-modes button')],
        defaultModeButtons: [...document.querySelectorAll('#default-modes button')],
        languageButtons: [...document.querySelectorAll('#lang-modes button')],
        langLabel: document.getElementById('lang-label'),
        settings: document.getElementById('settings'),
        settingsPanel: document.getElementById('settings-panel'),
        settingsTitle: document.getElementById('settings-title'),
        settingsHint: document.getElementById('settings-hint'),
        help: document.getElementById('help'),
        helpPanel: document.getElementById('help-panel'),
        helpAuto: document.getElementById('help-auto'),
        helpContrast: document.getElementById('help-contrast'),
        helpOff: document.getElementById('help-off'),
        helpDefault: document.getElementById('help-default'),
        shortcuts: document.getElementById('shortcuts'),
        promo: document.getElementById('promo')
    }
})

ui.init()

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
        const locales = [...document.querySelectorAll('#lang-select option')].map(option => option.value).filter(Boolean)
        const normalize = value => String(value || '').replace(/_/g, '-').toLowerCase()
        const language = normalize(lang || chrome.i18n.getUILanguage())
        const parts = language.split('-')
        let locale = locales.find(value => normalize(value) === language)
        if (!locale && parts[0] === 'zh') {
            const traditional = parts.includes('hant') || !parts.includes('hans') && parts.some(value => ['tw', 'hk', 'mo'].includes(value))
            locale = traditional ? 'zh_TW' : 'zh_CN'
        }
        locale ||= locales.find(value => normalize(value).split('-')[0] === parts[0]) || 'en'
        const read = async value => {
            try {
                const response = await fetch(chrome.runtime.getURL(`_locales/${value}/messages.json`))
                if (!response.ok) return {}
                return await response.json()
            } catch {
                return {}
            }
        }
        const fallback = await read('en')
        const messages = locale === 'en' ? fallback : await read(locale)
        const text = value => typeof value === 'string' && value.trim() ? value : ''
        return key => {
            let native = ''
            if (!lang) {
                try { native = chrome.i18n.getMessage(key) } catch {}
            }
            return text(native) || text(messages?.[key]?.message) || text(fallback?.[key]?.message) || key
        }
    }
}

const service = Toggle.createToggleService({
    storage: { local: chrome.storage.local }
})

const ui = PopupUi.createPopupUi({
    service,
    i18n,
    browserLang: chrome.i18n.getUILanguage(),
    getActiveTab: async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        return (tabs && tabs[0]) || null
    },
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    openPage: url => chrome.tabs.create({ url }),
    el: {
        root: document.documentElement,
        appTitle: document.getElementById('app-title'),
        enabledLabel: document.getElementById('enabled-label'),
        enabledToggle: document.getElementById('enabled-toggle'),
        siteLabel: document.getElementById('site-label'),
        siteModeButtons: [...document.querySelectorAll('#site-modes button')],
        defaultModeButtons: [...document.querySelectorAll('#default-modes button')],
        languageSelect: document.getElementById('lang-select'),
        langAutoOption: document.querySelector('#lang-select option[value=""]'),
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

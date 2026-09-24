// Popup UI behavior: which mode is selected in every state, what each click
// does, and when the settings/help panels show. All visible text comes from
// the injected i18n service (chrome.i18n + storage in popup.js, a fake in
// tests), so the user can switch language from the settings panel. The DOM
// elements, the mode service and the tab access are injected, so tests drive
// it on fake elements (tests/popup-ui.test.js); popup.js is only chrome glue.

function createPopupUi({ service, i18n, browserLang = 'en', getActiveTab, sendMessage, openPage, el }) {
    let siteMode = null // 'auto' | 'contrast' | 'off'; null = not a web page
    let defaultMode = 'auto'
    let settingsOpen = false
    let helpOpen = false
    let lang = ''      // '' = follow the browser
    let t = () => ''

    function applyText() {
        el.appTitle.textContent = t('appName')
        el.siteLabel.textContent = t('thisSite')
        const modeLabels = {
            auto: t('modeAuto'),
            contrast: t('modeContrast'),
            off: t('modeOff')
        }
        for (const button of [...el.siteModeButtons, ...el.defaultModeButtons]) {
            button.textContent = modeLabels[button.dataset.mode]
        }
        el.langLabel.textContent = t('langLabel')
        // the language names stay in their own language (static options in
        // popup.html); only the auto option translates
        el.langAutoOption.textContent = t('langAuto')
        // the popup's reading direction follows the effective language —
        // Arabic reads right-to-left, everything else left-to-right
        const effective = lang || browserLang
        el.root.setAttribute('lang', effective.replace('_', '-'))
        el.root.setAttribute('dir', effective.startsWith('ar') ? 'rtl' : 'ltr')
        el.settingsTitle.textContent = t('settingsTitle')
        el.settingsHint.textContent = t('settingsHint')
        el.helpAuto.textContent = t('helpAuto')
        el.helpContrast.textContent = t('helpContrast')
        el.helpOff.textContent = t('helpOff')
        el.helpDefault.textContent = t('helpDefault')
        el.settings.title = t('settingsTooltip')
        el.settings.setAttribute('aria-label', t('settingsTooltip'))
        el.help.title = t('helpTooltip')
        el.help.setAttribute('aria-label', t('helpTooltip'))
        el.shortcuts.textContent = t('shortcutsLink')
        el.promo.textContent = t('promoLine')
    }

    function render() {
        for (const button of el.siteModeButtons) {
            button.classList.toggle('selected', siteMode !== null && button.dataset.mode === siteMode)
            button.disabled = siteMode === null
        }
        for (const button of el.defaultModeButtons) {
            button.classList.toggle('selected', button.dataset.mode === defaultMode)
        }
        el.languageSelect.value = lang
        el.settingsPanel.hidden = !settingsOpen
        el.helpPanel.hidden = !helpOpen
    }

    // The active tab reloads so the change is visible right away; other tabs
    // pick it up on their next load. Pages without the content script
    // (chrome://, the store, …) just fail to receive it.
    async function reloadActiveTab() {
        const tab = await getActiveTab()
        if (!tab) return
        Promise.resolve(sendMessage(tab.id, 'reload')).catch(() => {})
    }

    for (const button of el.siteModeButtons) {
        button.addEventListener('click', async () => {
            const tab = await getActiveTab()
            const mode = await service.setSiteMode(tab && tab.url, button.dataset.mode)
            if (!mode) return
            siteMode = mode
            render()
            reloadActiveTab()
        })
    }

    for (const button of el.defaultModeButtons) {
        button.addEventListener('click', async () => {
            const mode = await service.setDefaultMode(button.dataset.mode)
            if (!mode) return
            defaultMode = mode
            render()
            // Sites without their own override follow the default, so the
            // current tab always re-applies here.
            reloadActiveTab()
        })
    }

    for (const button of el.defaultModeButtons) {
        button.addEventListener('click', async () => {
            const mode = await service.setDefaultMode(button.dataset.mode)
            if (!mode) return
            defaultMode = mode
            render()
            // Sites without their own override follow the default, so the
            // current tab always re-applies here.
            reloadActiveTab()
        })
    }

    el.languageSelect.addEventListener('change', async () => {
        lang = el.languageSelect.value
        await i18n.saveLang(lang)
        t = await i18n.load(lang)
        applyText()
        render()
    })

    el.settings.addEventListener('click', () => {
        settingsOpen = !settingsOpen
        settingsOpen && (helpOpen = false) // one panel at a time
        render()
    })

    el.help.addEventListener('click', () => {
        helpOpen = !helpOpen
        helpOpen && (settingsOpen = false)
        render()
    })

    el.shortcuts.addEventListener('click', event => {
        event.preventDefault()
        openPage('chrome://extensions/shortcuts')
    })

    async function init() {
        lang = await i18n.getSavedLang()
        t = await i18n.load(lang)
        applyText()
        const tab = await getActiveTab()
        siteMode = tab ? await service.getSiteMode(tab.url) : null
        defaultMode = await service.getDefaultMode()
        render()
    }

    return { init }
}

const PopupUi = { createPopupUi }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupUi
} else {
    globalThis.PopupUi = PopupUi
}

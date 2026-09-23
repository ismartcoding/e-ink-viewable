# E-ink Viewable

A chrome extension to make all websites viewable in e-ink screen, convert dark theme to light theme automatically.

## Modes

The popup has one switch for the current site (changes apply immediately):

- **舒适 (Auto, default)** — the per-node conversion engine described below. Keeps the site's own look as far as possible.
- **强对比 (Contrast)** — black-and-white mode: one wildcard stylesheet forces a white background with black text on every element (`!important`), drops shadows and grayscales media. The rules match inside shadow roots, so it also covers what the per-node engine cannot reach — on every site, dark or light.
- **关闭 (Off)** — the site's own look.

The gear icon in the popup sets the **default mode** for sites without their own choice. The keyboard shortcut (`Ctrl+Shift+X` by default) flips the current site between off and its last mode.

## How it works

- **Zero footprint when disabled.** On sites where you removed the ink style — and everywhere while "Pause on all sites" is on — the extension adds no CSS at all.
- **Colors only, and only what breaks on white.** Dark backgrounds become white; near-white text, borders and svg fills become black. Links, accent colors and mid grays keep the page's own color, so a page that is already light stays essentially untouched. All modern CSS color formats are understood (`oklch()`, `oklab()`, `lab()`, `color()`, `hsl()` — the ones Tailwind v4 and friends emit), and dark `:hover` / `:focus` styles are flipped the moment they appear — then once more after the site's own color transition settles, so animated hover colors can't stay invisible. Form state (`input:checked` tab groups) and class changes (theme toggles) re-plan the affected nodes through the same batched pipeline, and a re-plan only writes values that actually changed. Text that sits on a photo (banner images and the like) keeps the color the site chose for it — only opaque dark backgrounds are rewritten. `::before` / `::after` decorations are converted too, and gradient-clipped text (`background-clip: text`) is treated as text paint, not background.
- **No jank.** Computed styles are read in one phase and written in another, elements are processed in animation-frame batches and at most once each. Re-plans cost one computed-style read when nothing changed, class churn on framework pages costs one read per changed node, and the mutation observer only watches added nodes and `class` attributes — it can never react to its own writes.

Known limits: sites restyling existing nodes via inline `style` attribute writes are not observed (class changes and form state are), and shadow-DOM internals are not entered.

## Install from Chrome Web Store

https://chrome.google.com/webstore/detail/e-ink-viewable/lfeckmgmmnioloncabbkcddnnooofdmg

## Install from source code

1. Open `chrome://extensions/` in Chrome.
2. Enable `Developer mode`.
3. Click `Load unpacked` button and choose the `src` folder.

## Architecture

All decisions live in pure modules that never touch `chrome.*`, so every behavior is locked by unit tests running in plain Node:

- `src/color.js` — color math: parsing every CSS color format and deciding which colors to flip.
- `src/engine.js` — the conversion engine: skip rules, effective-background resolution, batching, mutation and hover handling. Computed styles and frame scheduling are injected; `inject.js` is its thin glue.
- `src/toggle.js` — per-site mode, global default and shortcut state on top of injected storage, plus one-time migration from the pre-1.4 pause flags.
- `src/popup-ui.js` — every popup label and click behavior, on injected elements/service.

`src/inject.js`, `src/background.js` and `src/popup.js` contain only `chrome.*` wiring.

## Development

```
node --test tests/*.test.js
```

## More from the author

[PlainApp](https://github.com/plainhub/plain-desktop) — an open-source Android app that lets you securely manage your phone (files, media, contacts, SMS, calls) from a web browser. Also on [Google Play](https://play.google.com/store/apps/details?id=com.ismartcoding.plain).

## Samples

<img src="images/codepen.gif" title="codepen.io">

<img src="images/stackoverflow.gif" title="stackoverflow.com">

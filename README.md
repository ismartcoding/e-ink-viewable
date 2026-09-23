# E-ink Viewable

A chrome extension to make all websites viewable in e-ink screen, convert dark theme to light theme automatically.

## How it works

- **Zero footprint when disabled.** On sites where you removed the ink style — and everywhere while "Pause on all sites" is on — the extension adds no CSS at all.
- **Colors only, and only what breaks on white.** Dark backgrounds become white; near-white text, borders and svg fills become black. Links, accent colors and mid grays keep the page's own color, so a page that is already light stays essentially untouched. Dark `:hover` / `:focus` styles (e.g. a menu item that turns black under the pointer) are flipped the moment they appear.
- **No jank.** Computed styles are read in one phase and written in another, elements are processed in animation-frame batches and at most once each, and the mutation observer only watches for newly added nodes — it can never react to its own writes.

Known limits: sites restyling *existing* nodes long after load (e.g. switching to a dark theme while the tab is open) need a reload to be converted again, and shadow-DOM internals are not entered.

## Install from Chrome Web Store

https://chrome.google.com/webstore/detail/e-ink-viewable/lfeckmgmmnioloncabbkcddnnooofdmg

## Install from source code

1. Open `chrome://extensions/` in Chrome.
2. Enable `Developer mode`.
3. Click `Load unpacked` button and choose the `src` folder.

## Development

```
node --test tests/*.test.js
```

## Samples

<img src="images/codepen.gif" title="codepen.io">

<img src="images/stackoverflow.gif" title="stackoverflow.com">

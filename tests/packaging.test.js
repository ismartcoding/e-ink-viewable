// Packaging integrity: every file the extension references must exist in
// src/, and the service worker must keep its static import. A missing file
// is invisible until an installed package throws at runtime (the
// importScripts NetworkError class of failure) — this locks it in CI.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = path.join(__dirname, '..', 'src')
const exists = relative => fs.existsSync(path.join(src, relative))

test('every file the manifest references exists in src/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
    const referenced = [
        manifest.background.service_worker,
        manifest.action.default_popup,
        ...Object.values(manifest.icons),
        ...Object.values(manifest.action.default_icon),
        ...manifest.content_scripts.flatMap(script => script.js)
    ]
    for (const file of referenced) {
        assert.ok(exists(file), `manifest references missing file: ${file}`)
    }
})

test('popup.html references resolve, and they resolve from the manifest too', () => {
    const html = fs.readFileSync(path.join(src, 'popup.html'), 'utf8')
    const referenced = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
        .map(match => match[1])
        .filter(url => !url.startsWith('http'))
    assert.ok(referenced.length >= 4)
    for (const file of referenced) assert.ok(exists(file), `popup.html references missing file: ${file}`)
})

test('the service worker imports statically — importScripts must not return', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
    assert.equal(manifest.background.type, 'module')
    const background = fs.readFileSync(path.join(src, 'background.js'), 'utf8')
    assert.doesNotMatch(background, /^\s*importScripts\s*\(/m) // no runtime script loading
    assert.match(background, /^import '\.\/toggle\.js'/m)
})

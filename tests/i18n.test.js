// Locale packaging is data, not code — lock it: exactly the 17 shipped
// locales, every key present with non-empty text in every one of them, and
// the popup's language dropdown listing exactly those locales.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = path.join(__dirname, '..', 'src')
const localesDir = path.join(src, '_locales')

const EXPECTED = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt_BR', 'ru', 'th', 'tr', 'vi', 'zh_CN', 'zh_TW'].sort()

test('17 locales ship and en is the manifest default', () => {
    assert.deepEqual(fs.readdirSync(localesDir).sort(), EXPECTED)
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
    assert.equal(manifest.default_locale, 'en')
})

test('every locale carries the full key set with non-empty messages', () => {
    const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en/messages.json'), 'utf8'))
    const keys = Object.keys(en).sort()
    assert.equal(keys.length, 20)
    for (const locale of EXPECTED) {
        const messages = JSON.parse(fs.readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf8'))
        assert.deepEqual(Object.keys(messages).sort(), keys, `${locale}: key set differs`)
        for (const [key, entry] of Object.entries(messages)) {
            assert.equal(typeof entry.message, 'string', `${locale}/${key}`)
            assert.ok(entry.message.trim().length > 0, `${locale}/${key}: empty message`)
        }
    }
})

test('the popup language dropdown lists exactly the shipped locales', () => {
    const html = fs.readFileSync(path.join(src, 'popup.html'), 'utf8')
    const values = [...html.matchAll(/<option value="([^"]*)"/g)].map(match => match[1])
    assert.equal(values[0], '') // first option: follow the browser
    assert.deepEqual(values.slice(1).sort(), EXPECTED)
})

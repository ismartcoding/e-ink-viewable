const test = require('node:test')
const assert = require('node:assert/strict')
const Toggle = require('../src/toggle.js')

function fakeStorage(local = {}, sync = {}) {
    return {
        local: {
            async get(key) {
                if (key === null) return { ...local }
                if (Array.isArray(key)) return Object.fromEntries(key.filter(k => k in local).map(k => [k, local[k]]))
                return key in local ? { [key]: local[key] } : {}
            },
            async set(items) { Object.assign(local, items) },
            async remove(keys) { for (const k of [].concat(keys)) delete local[k] }
        },
        sync: {
            async get(key) {
                if (key === null) return { ...sync }
                return Object.fromEntries(Object.keys(sync).filter(k => key.includes(k)).map(k => [k, sync[k]]))
            }
        },
        localData: local
    }
}

test('siteKey derives the per-site key from any URL of the host', () => {
    assert.equal(Toggle.siteKey('https://github.com/foo/bar'), 'i:github.com')
    assert.equal(Toggle.siteKey('http://a.example.com:8080/x?y=1'), 'i:a.example.com:8080') // host keeps the port
})

test('isWebUrl accepts only http(s)', () => {
    assert.equal(Toggle.isWebUrl('https://a.com'), true)
    assert.equal(Toggle.isWebUrl('http://a.com'), true)
    assert.equal(Toggle.isWebUrl('chrome://extensions/shortcuts'), false)
    assert.equal(Toggle.isWebUrl(''), false)
    assert.equal(Toggle.isWebUrl(undefined), false)
})

test('getSiteMode: absent everywhere → auto, default → default, override wins', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.getSiteMode('https://a.com/x'), 'auto')

    await service.setDefaultMode('contrast')
    assert.equal(await service.getSiteMode('https://a.com/x'), 'contrast')

    await service.setSiteMode('https://a.com/x', 'off') // override beats a non-off default
    assert.equal(await service.getSiteMode('https://a.com/x'), 'off')
    // another host without an override still follows the default
    assert.equal(await service.getSiteMode('https://b.com'), 'contrast')
})

test('getSiteMode on a non-web page is null', async () => {
    const service = Toggle.createToggleService({ storage: fakeStorage() })
    assert.equal(await service.getSiteMode('chrome://version'), null)
})

test('setSiteMode stores the override and remembers non-off modes for the shortcut', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.setSiteMode('https://a.com/x', 'contrast'), 'contrast')
    assert.equal(storage.localData['i:a.com'], 'contrast')
    assert.equal(storage.localData['l:a.com'], 'contrast')

    assert.equal(await service.setSiteMode('https://a.com/x', 'off'), 'off')
    assert.equal(storage.localData['i:a.com'], 'off')
    assert.equal(storage.localData['l:a.com'], 'contrast') // last non-off kept
})

test('setSiteMode rejects junk modes and non-web pages, storing nothing', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.setSiteMode('https://a.com', 'dark'), null)
    assert.equal(await service.setSiteMode('chrome://version', 'auto'), null)
    assert.deepEqual(storage.localData, {})
})

test('getDefaultMode / setDefaultMode round-trip', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.getDefaultMode(), 'auto')
    await service.setDefaultMode('off')
    assert.equal(await service.getDefaultMode(), 'off')
    assert.equal(await service.setDefaultMode('nonsense'), null)
    assert.equal(await service.getDefaultMode(), 'off')
})

test('toggleShortcut turns a running mode off', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })
    await service.setSiteMode('https://a.com/x', 'contrast')

    assert.equal(await service.toggleShortcut('https://a.com/x'), 'off')
    assert.equal(await service.getSiteMode('https://a.com/x'), 'off')
})

test('toggleShortcut restores the site\'s last mode', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })
    await service.setSiteMode('https://a.com/x', 'contrast')
    await service.toggleShortcut('https://a.com/x')

    assert.equal(await service.toggleShortcut('https://a.com/x'), 'contrast')
    assert.equal(await service.getSiteMode('https://a.com/x'), 'contrast')
})

test('toggleShortcut without a last mode falls back to the default, then auto', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    // never set: default is auto
    assert.equal(await service.toggleShortcut('https://a.com/x'), 'off')
    assert.equal(await service.toggleShortcut('https://a.com/x'), 'auto')

    // a contrast default is restorable; an off default is not — auto wins
    const other = fakeStorage()
    const service2 = Toggle.createToggleService({ storage: other })
    await service2.setDefaultMode('contrast')
    assert.equal(await service2.toggleShortcut('https://a.com/x'), 'off')
    assert.equal(await service2.toggleShortcut('https://a.com/x'), 'contrast')

    const third = fakeStorage()
    const service3 = Toggle.createToggleService({ storage: third })
    await service3.setDefaultMode('off')
    // an off default already reads as off, so the first flip restores 'auto'
    assert.equal(await service3.toggleShortcut('https://a.com/x'), 'auto')
    assert.equal(await service3.toggleShortcut('https://a.com/x'), 'off')
})

test('toggleShortcut on a non-web page is a no-op', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })
    assert.equal(await service.toggleShortcut('chrome://version'), null)
    assert.deepEqual(storage.localData, {})
})

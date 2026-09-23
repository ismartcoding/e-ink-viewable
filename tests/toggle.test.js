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
            async set(items) { Object.assign(local, items) }
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

test('siteKey derives the per-site flag from any URL of the host', () => {
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

test('toggle flips undefined → paused and paused → applied', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.deepEqual(await service.toggle('https://a.com/x'), { paused: true })
    assert.equal(storage.localData['i:a.com'], 1)

    assert.deepEqual(await service.toggle('https://a.com/x'), { paused: false })
    assert.equal(storage.localData['i:a.com'], 0)

    assert.deepEqual(await service.toggle('https://a.com/x'), { paused: true })
})

test('toggle on a non-web page is a no-op', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.toggle('chrome://extensions/shortcuts'), null)
    assert.deepEqual(storage.localData, {})
})

test('getState: boolean for web pages, null elsewhere', async () => {
    const storage = fakeStorage({ 'i:paused.com': 1 })
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.getState('https://paused.com/x'), true)
    assert.equal(await service.getState('https://other.com'), false)
    assert.equal(await service.getState('chrome://version'), null)
})

test('getGlobal / setGlobal drive the pause-everywhere flag', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.getGlobal(), false)
    await service.setGlobal(true)
    assert.equal(storage.localData['p:all'], 1)
    assert.equal(await service.getGlobal(), true)
    await service.setGlobal(false)
    assert.equal(await service.getGlobal(), false)
})

test('per-site pause and global pause are independent flags', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })
    await service.toggle('https://a.com')
    await service.setGlobal(true)

    assert.equal(await service.getState('https://a.com'), true)
    assert.equal(await service.getGlobal(), true)
})

test('migrateSync copies old per-site keys from sync, nothing else', async () => {
    const storage = fakeStorage({}, {
        'i:old.com': 1,
        'unrelated': 'x'
    })
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.migrateSync(), 1)
    assert.equal(storage.localData['i:old.com'], 1)
    assert.equal(storage.localData['unrelated'], undefined)

    // re-running (every browser start) re-copies the same values — harmless
    assert.equal(await service.migrateSync(), 1)
    assert.equal(storage.localData['i:old.com'], 1)
})

test('migrateSync with an empty sync area writes nothing', async () => {
    const storage = fakeStorage()
    const service = Toggle.createToggleService({ storage })

    assert.equal(await service.migrateSync(), 0)
    assert.deepEqual(storage.localData, {})
})

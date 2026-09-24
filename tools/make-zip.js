// Packages src/ into src.zip for the Chrome Web Store: manifest.json at the
// zip root, nothing else included. Runs the same reference checks as
// tests/packaging.test.js first, so a zip can never be built from a tree
// that would throw at runtime (the importScripts NetworkError failure).
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const src = path.join(root, 'src')
const zipPath = path.join(root, 'src.zip')

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(script => script.js)
]
const missing = referenced.filter(file => !fs.existsSync(path.join(src, file)))
if (missing.length) {
    console.error('refusing to pack — files referenced by the manifest are missing:\n' + missing.join('\n'))
    process.exit(1)
}

if (fs.existsSync(zipPath)) fs.rmSync(zipPath)
execSync(`cd ${src} && zip -rq ${zipPath} . -x '.DS_Store'`, { stdio: 'inherit' })

const entries = execSync(`unzip -l ${zipPath}`).toString().split('\n')
    .map(line => line.trim().split(/\s+/)[3]).filter(Boolean)
const required = ['manifest.json', 'background.js', 'toggle.js', 'popup.html', '_locales/en/messages.json']
const absent = required.filter(name => !entries.includes(name))
if (absent.length) {
    console.error('zip built but required entries are missing:\n' + absent.join('\n'))
    process.exit(1)
}
console.log(`${zipPath}: ${entries.length} entries, ${fs.statSync(zipPath).size} bytes`)

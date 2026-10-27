import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DEFAULT_OUT, GENERATED, SERVICE_ONLY, distManifest, manifestText, options, writeManifest} from '../scripts/dist-manifest.js'

test('the committed manifest is what the folder actually holds',() => {
 assert.equal(readFileSync(DEFAULT_OUT, 'utf8'), manifestText('dist'), 'run npm run manifest: dist/manifest.json is out of date')
 const {shared, service} = distManifest('dist')
 for (const name of ['index.html', 'app.js', 'boot.js', 'site.js', 'styles.css', 'favicon.svg', 'ui/render.js', 'ui/pages/watchroom.js', 'fonts/dm-sans-variable.woff2', 'fonts/OFL-DMSans.txt']) {
  assert.ok(shared.includes(name), `${name} is needed by any host and belongs in shared`)
 }
 assert.deepEqual(service, SERVICE_ONLY, 'only the notifications page is service only')
 assert.equal(shared.filter(name => service.includes(name)).length, 0, 'the two lists do not overlap')
 for (const name of GENERATED) assert.ok(!shared.includes(name) && !service.includes(name), `${name} is written, not copied`)
})

test('the manifest is sorted, uses URL paths, and is written only when it changes',() => {
 const folder = mkdtempSync(join(tmpdir(), 'awaker-manifest-'))
 try {
  mkdirSync(join(folder, 'ui', 'pages'), {recursive: true})
  writeFileSync(join(folder, 'index.html'), '<!doctype html>')
  writeFileSync(join(folder, 'app.js'), '')
  writeFileSync(join(folder, 'integrations.html'), '')
  writeFileSync(join(folder, 'players.json'), '{}')
  writeFileSync(join(folder, 'site.json'), '{}')
  writeFileSync(join(folder, 'ui', 'pages', 'watchroom.js'), '')
  assert.deepEqual(distManifest(folder), {shared: ['app.js', 'index.html', 'ui/pages/watchroom.js'], service: ['integrations.html']})

  const out = join(folder, 'manifest.json')
  assert.equal(writeManifest(folder, out).changed, true)
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).shared.length, 3)
  assert.equal(writeManifest(folder, out).changed, false, 'a folder that has not changed leaves the file alone')
  writeFileSync(join(folder, 'later.js'), '')
  const again = writeManifest(folder, out)
  assert.equal(again.changed, true)
  assert.ok(again.shared.includes('later.js'), 'a new file cannot be forgotten')

  assert.equal(options([]).out, DEFAULT_OUT)
  assert.deepEqual(options(['--out=a.json']), {out: 'a.json'})
  assert.throws(() => options(['--all']), /Unknown option --all/)
  assert.throws(() => options(['--out']), /needs a path/)
  assert.throws(() => distManifest(join(folder, 'ui')), /not the app folder/)
 } finally { rmSync(folder, {recursive: true, force: true}) }
})

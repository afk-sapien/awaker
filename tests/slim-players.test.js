import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {serveStatic} from '../server/static.js'
import {createHttpServer} from '../server/http.js'
import {createService} from '../server/service.js'
import {openStore} from '../server/store.js'
import {httpRequest} from '../scripts/http-request.js'
import {buildPlayersFile, options, slimFile, writeSlimPlayers, DEFAULT_OUT} from '../scripts/slim-players.js'
import {loadPlayers, slimPlayerFile, SLIM_MINIMUM, SLIM_MAX_AGE} from '../dist/api.js'

const directory = (count = 4) => {
 const players = {}
 for (let i = 1; i <= count; i++) players[1000 + i] = {full_name: `Player ${i}`, first_name: 'Player', last_name: String(i), position: 'WR', fantasy_positions: ['WR'], team: 'BUF', number: i, injury_status: null, active: true, search_rank: i, college: 'State', metadata: {huge: 'x'.repeat(200)}}
 return players
}

test('the slimmed file keeps only the fields the app reads, with the time it was written',() => {
 const source = {...directory(2), ref: {position: 'REF', active: true}, ghost: {position: 'WR', active: false}, 1: null}
 const file = slimFile(source, Date.parse('2026-10-26T12:00:00Z'))
 assert.equal(file.generatedAt, '2026-10-26T12:00:00.000Z')
 assert.equal(file.count, 2)
 assert.deepEqual(Object.keys(file.players), ['1001', '1002'])
 assert.deepEqual(Object.keys(file.players['1001']), ['full_name', 'first_name', 'last_name', 'position', 'fantasy_positions', 'team', 'number', 'active'])
 assert.equal(file.players['1001'].injury_status, undefined, 'an absent designation is not written as null')
 assert.throws(() => slimFile({}), /No fantasy players/)
 assert.throws(() => slimFile([]), /keyed by player id/)
 assert.throws(() => slimFile(null), /keyed by player id/)
})

test('the generator writes one file to the chosen path and reports its size',() => {
 const folder = mkdtempSync(join(tmpdir(), 'awaker-slim-'))
 try {
  const source = join(folder, 'directory.json')
  const out = join(folder, 'nested', 'players.json')
  writeFileSync(source, JSON.stringify(directory(600)))
  const printed = execFileSync(process.execPath, [resolve('scripts/slim-players.js'), '--from=' + source, '--out', out], {encoding: 'utf8'})
  assert.match(printed, /600 players, \d+ KB \(\d+ KB gzipped\)/)
  const file = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(file.count, 600)
  assert.equal(file.players['1001'].full_name, 'Player 1')
  assert.equal(file.players['1001'].metadata, undefined)
  assert.equal(options([]).out, DEFAULT_OUT)
  assert.deepEqual(options(['--out', 'a.json', '--from=b.json']), {out: 'a.json', from: 'b.json'})
  assert.throws(() => options(['--all']), /Unknown option --all/)
  assert.throws(() => options(['--out']), /needs a path/)
  const written = writeSlimPlayers(directory(600), out)
  assert.equal(written.count, 600)
  assert.ok(written.gzipBytes < written.bytes)
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).count, 600, 'the file is replaced, not appended to')
 } finally { rmSync(folder, {recursive: true, force: true}) }
})

test('the generator is callable from Node and reports what it wrote',async () => {
 const folder = mkdtempSync(join(tmpdir(), 'awaker-build-'))
 try {
  const source = join(folder, 'directory.json')
  const out = join(folder, 'nested', 'players.json')
  writeFileSync(source, JSON.stringify(directory(600)))
  const before = Date.now()
  const result = await buildPlayersFile({out, from: source})
  assert.deepEqual(Object.keys(result), ['path', 'count', 'generatedAt', 'bytes', 'gzipBytes'])
  assert.equal(result.path, resolve(out))
  assert.equal(result.count, 600)
  assert.ok(result.gzipBytes < result.bytes)
  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(written.generatedAt, result.generatedAt, 'the caller is told the time that travels with the file')
  assert.ok(Date.parse(result.generatedAt) >= before, 'and it is when the file was written, not when it was asked for')
  assert.ok(Date.now() - Date.parse(result.generatedAt) < SLIM_MAX_AGE, 'so the file it just wrote counts as fresh')
  await assert.rejects(() => buildPlayersFile({out, from: join(folder, 'missing.json')}), /ENOENT/)
 } finally { rmSync(folder, {recursive: true, force: true}) }
})

test('the written file is served from the app folder as compressed JSON',async () => {
 const folder = mkdtempSync(join(tmpdir(), 'awaker-serve-'))
 try {
  writeSlimPlayers(directory(600), join(folder, 'players.json'))
  const ask = async encoding => {
   const sent = {}
   const res = {setHeader() {}, writeHead(status, headers) { Object.assign(sent, {status, headers}) }, end(body) { sent.body = body }}
   await serveStatic({method: 'GET', headers: encoding ? {'accept-encoding': encoding} : {}}, res, folder, '/players.json')
   return sent
  }
  const plain = await ask(null)
  assert.equal(plain.status, 200)
  assert.equal(plain.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(plain.headers['Content-Encoding'], undefined)
  assert.equal(JSON.parse(plain.body.toString()).count, 600)
  const zipped = await ask('gzip')
  assert.equal(zipped.headers['Content-Encoding'], 'gzip')
  assert.ok(zipped.body.length < plain.body.length)
 } finally { rmSync(folder, {recursive: true, force: true}) }
})

test('the dashboard serves itself the slimmed directory only while it is fresh and whole',async () => {
 const original = globalThis.fetch
 const full = {'9000': {full_name: 'From Sleeper', position: 'WR'}}
 const asked = []
 let served = null
 globalThis.location = {href: 'http://127.0.0.1:4173/', origin: 'http://127.0.0.1:4173'}
 globalThis.fetch = async url => {
  asked.push(String(url))
  if (String(url).endsWith('/players.json')) return served === null ? new Response('', {status: 404}) : Response.json(served)
  return Response.json(full)
 }
 const slim = count => ({generatedAt: new Date().toISOString(), count, players: Object.fromEntries(Array.from({length: count}, (_, i) => [2000 + i, {full_name: 'Player ' + i, position: 'WR'}]))})
 try {
  served = slim(SLIM_MINIMUM)
  const used = await loadPlayers({force: true})
  assert.equal(Object.keys(used).length, SLIM_MINIMUM)
  assert.equal(used['9000'], undefined, 'the full directory is not fetched when the file is usable')
  assert.ok(asked.every(url => url.startsWith(globalThis.location.origin)))

  for (const [label, file] of [
   ['a short file', slim(SLIM_MINIMUM - 1)],
   ['an old file', {...slim(SLIM_MINIMUM), generatedAt: new Date(Date.now() - SLIM_MAX_AGE - 1000).toISOString()}],
   ['an undated file', {...slim(SLIM_MINIMUM), generatedAt: 'last Tuesday'}],
   ['a directory with no players', {generatedAt: new Date().toISOString(), players: null}],
   ['a bare directory', slim(SLIM_MINIMUM).players],
   ['a row that is not a player', {generatedAt: new Date().toISOString(), players: {...slim(SLIM_MINIMUM).players, 2000: 'Player 0'}}]
  ]) {
   served = file
   assert.equal(await slimPlayerFile(), null, label)
   assert.deepEqual(await loadPlayers({force: true}), full, label)
  }

  served = null
  assert.deepEqual(await loadPlayers({force: true}), full, 'no file at all falls back to the full directory')
  globalThis.fetch = async () => { throw TypeError('offline') }
  assert.equal(await slimPlayerFile(), null, 'a failed request for the file is not an error')
 } finally {
  globalThis.fetch = original
  delete globalThis.location
 }
})

const live = (count = 600, base = 5000) => Object.fromEntries(Array.from({length: count}, (_, i) => [base + i, {full_name: `Live ${i}`, position: 'WR', team: 'BUF'}]))

test('a service holds the directory from its last refresh and answers without starting another',async () => {
 const store = openStore(':memory:')
 try {
  const at = Date.parse('2026-10-26T12:00:00Z')
  const players = live(3)
  let refreshes = 0
  const provider = async () => { refreshes++; return {players, playersAt: at - 3600000, updatedAt: at, leagues: [], errors: []} }
  const service = createService({store, provider, now: () => at})
  service.saveSettings({username: 'example'})
  assert.equal(service.playerDirectory(), null, 'there is nothing to serve before the first refresh')
  await service.load()
  assert.deepEqual(service.playerDirectory(), {at: at - 3600000, players})
  assert.equal(refreshes, 1)
 } finally { store.close() }
})

test('the service answers players.json itself and leaves the written file as the fallback',async t => {
 const folder = mkdtempSync(join(tmpdir(), 'awaker-route-'))
 try {
  writeSlimPlayers(directory(600), join(folder, 'players.json'), Date.parse('2026-10-26T06:00:00Z'))
  const origin = 'http://127.0.0.1:4173'
  let at = Date.parse('2026-10-26T12:00:00Z'), current = null, loads = 0
  const service = {settings: () => ({username: 'example'}), load: async () => { loads++; return {} }, playerDirectory: () => current}
  const server = createHttpServer({service, worker: {status: () => ({})}, adminToken: 'a'.repeat(40), agentToken: 'b'.repeat(40), publicUrl: origin, dist: folder, now: () => at})
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  t.after(() => new Promise(done => server.close(done)))
  const ask = (headers = {}, method = 'GET') => httpRequest(`http://127.0.0.1:${server.address().port}/players.json`, {method, headers: {Host: new URL(origin).host, ...headers}})

  const fallback = await ask()
  assert.equal(fallback.status, 200)
  assert.equal((await fallback.json()).players['1001'].full_name, 'Player 1', 'with no refresh yet the written file is served')

  current = {at: at - 3600000, players: live(600)}
  const served = await ask()
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(served.headers.get('cache-control'), 'no-cache')
  assert.equal(served.headers.get('x-frame-options'), 'DENY')
  const file = await served.json()
  assert.equal(file.count, 600)
  assert.equal(file.generatedAt, new Date(at - 3600000).toISOString(), 'the time it was refreshed travels with it')
  assert.equal(file.players['5000'].full_name, 'Live 0', 'the directory in memory wins over the older file')
  assert.equal(file.players['1001'], undefined)

  const etag = served.headers.get('etag')
  assert.match(etag, /^"[\w-]{27}"$/)
  const revalidated = await ask({'If-None-Match': etag})
  assert.equal(revalidated.status, 304)
  assert.equal(await revalidated.text(), '')
  const zipped = await ask({'Accept-Encoding': 'gzip'})
  assert.equal(zipped.headers.get('content-encoding'), 'gzip')
  assert.equal(zipped.headers.get('vary'), 'Accept-Encoding')
  assert.ok(Number(zipped.headers.get('content-length')) < Number(served.headers.get('content-length')))
  assert.notEqual(zipped.headers.get('etag'), etag, 'a compressed body is a different entity')
  const head = await ask({}, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  // The route and the browser read one window, so the boundary is asserted against that constant
  // rather than against a copy of the number.
  current = {at: at - SLIM_MAX_AGE + 1000, players: live(600)}
  assert.equal((await (await ask()).json()).players['5000'].full_name, 'Live 0', 'a snapshot inside the window is still served')
  current = {at: at - SLIM_MAX_AGE, players: live(600)}
  const stale = await ask()
  assert.equal((await stale.json()).players['1001'].full_name, 'Player 1', 'a stale snapshot must not shadow a newer file')
  current = {at: Number.NaN, players: live(600)}
  assert.equal((await (await ask()).json()).players['1001'].full_name, 'Player 1', 'an undated snapshot is not served either')
  assert.equal((await ask({}, 'POST')).status, 405)
  assert.equal(loads, 0, 'anonymous traffic must not be able to start a refresh')
 } finally { rmSync(folder, {recursive: true, force: true}) }
})

test('the file is ignored in Node and when it would come from another origin',async () => {
 const original = globalThis.fetch
 globalThis.fetch = async () => { throw Error('no request should be made') }
 try {
  delete globalThis.location
  assert.equal(await slimPlayerFile(), null, 'there is no page to read the file from')
  globalThis.location = {href: 'http://127.0.0.1:4173/', origin: 'https://awaker.example'}
  assert.equal(await slimPlayerFile(), null, 'the file is never read across origins')
 } finally {
  globalThis.fetch = original
  delete globalThis.location
 }
})

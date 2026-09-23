import {httpRequest} from '../scripts/http-request.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve, join} from 'node:path'
import {createHttpServer} from '../server/http.js'
import {config, publicOrigin} from '../server/config.js'

const owner = 'a'.repeat(40)
const agent = 'b'.repeat(40)
const origin = 'http://127.0.0.1:4173'
async function harness(t, options = {}) {
  let at = Date.now()
  const service = {settings: () => ({username: 'example'}), saveSettings: input => input, status: async () => ({ok: true})}
  const server = createHttpServer({service, worker: {status: () => ({})}, adminToken: owner, agentToken: agent, publicUrl: origin, dist: resolve('dist'), now: () => at, ...options})
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  t.after(() => new Promise(done => server.close(done)))
  const request = (path, options = {}) => httpRequest(`http://127.0.0.1:${server.address().port}${path}`, {
    ...options, headers: {Host: new URL(origin).host, ...options.headers}
  })
  return {request, port: server.address().port, advance: duration => { at += duration }}
}

async function login(request) {
  const response = await request('/api/v1/session', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({token: owner})})
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /HttpOnly/)
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/)
  return response.headers.get('set-cookie').split(';')[0]
}

test('explicit invalid credentials cannot fall back to an owner cookie', async t => {
  const {request, advance} = await harness(t)
  const Cookie = await login(request)
  assert.equal((await request('/api/v1/settings', {headers: {Cookie}})).status, 200)
  assert.equal((await request('/api/v1/settings', {headers: {Cookie, Authorization: 'Bearer wrong'}})).status, 401)
  assert.equal((await request('/api/v1/settings', {headers: {Cookie, Authorization: `Bearer ${agent}`}})).status, 403)
  assert.equal((await request('/api/v1/session', {method: 'DELETE', headers: {Cookie, Origin: origin}})).status, 200)
  assert.equal((await request('/api/v1/settings', {headers: {Cookie}})).status, 401)
  const expired = await login(request)
  advance(8 * 3600000)
  assert.equal((await request('/api/v1/settings', {headers: {Cookie: expired}})).status, 401)
})

test('host validation, security headers and health checks do not disclose account data', async t => {
  const {request} = await harness(t)
  assert.equal((await request('/', {headers: {Host: 'evil.example'}})).status, 403)
  assert.equal((await request('/healthz', {headers: {Origin: 'https://evil.example'}})).status, 403)
  const health = await request('/healthz')
  assert.deepEqual(await health.json(), {status: 'ok'})
  for (const path of ['/', '/integrations.html', '/api/v1/settings']) {
    const response = await request(path)
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/)
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  }
  const head = await request('/', {method: 'HEAD'})
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal((await request('/', {method: 'POST'})).status, 405)
})

test('static files revalidate by ETag, compress text and load fonts from this server only', async t => {
  const {request} = await harness(t)
  const first = await request('/app.js')
  const etag = first.headers.get('etag')
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'no-cache')
  assert.match(etag, /^"[\w-]+"$/)
  assert.equal(first.headers.get('content-encoding'), null)
  const again = await request('/app.js', {headers: {'If-None-Match': etag}})
  assert.equal(again.status, 304)
  assert.equal(await again.text(), '')
  const gzip = await request('/app.js', {headers: {'Accept-Encoding': 'gzip, br'}})
  assert.equal(gzip.headers.get('content-encoding'), 'gzip')
  assert.equal(gzip.headers.get('vary'), 'Accept-Encoding')
  assert.notEqual(gzip.headers.get('etag'), etag)
  assert.equal((await request('/app.js', {headers: {'Accept-Encoding': 'gzip', 'If-None-Match': gzip.headers.get('etag')}})).status, 304)
  const font = await request('/fonts/dm-sans-variable.woff2', {headers: {'Accept-Encoding': 'gzip'}})
  assert.equal(font.status, 200)
  assert.equal(font.headers.get('content-type'), 'font/woff2')
  assert.equal(font.headers.get('content-encoding'), null)
  const csp = first.headers.get('content-security-policy')
  assert.match(csp, /font-src 'self'(;|$)/)
  assert.doesNotMatch(csp, /googleapis|gstatic/)
  assert.doesNotMatch(await (await request('/styles.css')).text(), /@import|googleapis|gstatic/)
})

test('JSON request limits return useful errors without resetting the connection', async t => {
  const {request} = await harness(t)
  const headers = {Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json'}
  const send = body => request('/api/v1/settings', {method: 'PUT', headers, body})
  assert.equal((await request('/api/v1/settings', {method: 'PUT', headers: {Authorization: `Bearer ${owner}`}, body: '{}'})).status, 415)
  assert.equal((await send('{')).status, 400)
  const large = await send(JSON.stringify({value: 'x'.repeat(65536)}))
  assert.equal(large.status, 413)
  assert.match((await large.json()).error, /too large/)
  assert.deepEqual((await (await send(JSON.stringify({value: '日本語 🏈'}))).json()).settings, {value: '日本語 🏈'})
  assert.equal((await request('/api/v1/session', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: 'null'})).status, 401)
})

test('file serving blocks hidden files, malformed paths and symlinks outside dist', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'awaker-static-'))
  t.after(() => rmSync(dir, {recursive: true, force: true}))
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'secret.js'), 'private')
  writeFileSync(join(dir, 'dist', '.hidden.js'), 'private')
  symlinkSync(join(dir, 'secret.js'), join(dir, 'dist', 'escape.js'))
  const {request} = await harness(t, {dist: join(dir, 'dist')})
  for (const path of ['/escape.js', '/.hidden.js', '/%2e%2e%2fsecret.js', '/%00.js', '/package.json']) {
    assert.equal((await request(path)).status, 404, path)
  }
  assert.equal((await request('/%ZZ.js')).status, 400)
})

test('API request limits expire and health remains available', async t => {
  const {request, advance} = await harness(t)
  for (const attempt of Array.from({length: 30})) assert.equal((await request('/api/v1/settings')).status, 401)
  const blocked = await request('/api/v1/settings')
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('retry-after'), '60')
  assert.equal((await request('/healthz')).status, 200)
  advance(60000)
  assert.equal((await request('/api/v1/settings')).status, 401)
})

test('anonymous traffic from a reverse proxy address cannot lock out the owner or the agent', async t => {
  const {request, advance} = await harness(t)
  for (const attempt of Array.from({length: 31})) await request('/api/v1/settings')
  // A wrong credential counts as anonymous, so it cannot be used to guess tokens any faster.
  assert.equal((await request('/api/v1/settings', {headers: {Authorization: 'Bearer wrong'}})).status, 429)
  assert.equal((await request('/api/v1/session', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({token: owner})})).status, 429)
  assert.equal((await request('/api/v1/settings', {headers: {Authorization: `Bearer ${owner}`}})).status, 200)
  assert.equal((await request('/api/v1/status', {headers: {Authorization: `Bearer ${agent}`}})).status, 200)
  // Each credential still has its own ceiling, and using it up does not touch the other one.
  for (const attempt of Array.from({length: 119})) await request('/api/v1/settings', {headers: {Authorization: `Bearer ${owner}`}})
  assert.equal((await request('/api/v1/settings', {headers: {Authorization: `Bearer ${owner}`}})).status, 429)
  assert.equal((await request('/api/v1/status', {headers: {Authorization: `Bearer ${agent}`}})).status, 200)
  advance(60000)
  assert.equal((await request('/api/v1/settings', {headers: {Authorization: `Bearer ${owner}`}})).status, 200)
})

test('a thousand anonymous addresses fill the rate table without shutting out the owner', {skip: process.platform !== 'linux' && 'needs the whole 127.0.0.0/8 loopback range'}, async t => {
  const {request: http} = await import('node:http')
  const {port} = await harness(t)
  const from = (localAddress, headers = {}) => new Promise((done, fail) => {
    const req = http({host: '127.0.0.1', port, path: '/api/v1/settings', localAddress, headers: {Host: new URL(origin).host, ...headers}}, res => { res.resume(); res.on('end', () => done(res.statusCode)) })
    req.on('error', fail)
    req.end()
  })
  const addresses = Array.from({length: 1000}, (_, i) => `127.0.${1 + Math.floor(i / 250)}.${1 + i % 250}`)
  for (let i = 0; i < addresses.length; i += 50) await Promise.all(addresses.slice(i, i + 50).map(address => from(address)))
  assert.equal(await from('127.0.9.9'), 429, 'a new anonymous address is refused once the table is full')
  assert.equal(await from('127.0.9.9', {Authorization: `Bearer ${owner}`}), 200)
  // The agent is let in too: it is refused the owner route itself, not throttled.
  assert.equal(await from('127.0.9.10', {Authorization: `Bearer ${agent}`}), 403)
})

test('concurrent analysis is bounded and capacity returns after failure', async t => {
  const resolvers = []
  let started
  const allStarted = new Promise(resolve => { started = resolve })
  const {request} = await harness(t, {service: {
    status: () => new Promise((resolve, reject) => {
      resolvers.push({resolve, reject})
      if (resolvers.length === 4) started()
    })
  }})
  const options = {headers: {Authorization: `Bearer ${agent}`}}
  const pending = Array.from({length: 4}, () => request('/api/v1/status', options))
  await allStarted
  try {
    const busy = await request('/api/v1/status', options)
    assert.equal(busy.status, 503)
    assert.equal(busy.headers.get('retry-after'), '5')
    assert.equal((await request('/healthz')).status, 200)
  } finally {
    resolvers[0].reject(Error('Provider failed'))
    resolvers.slice(1).forEach(({resolve}) => resolve({ok: true}))
  }
  const results = await Promise.all(pending)
  assert.deepEqual(results.map(result => result.status).sort(), [200, 200, 200, 500])
  const recovered = request('/api/v1/status', options)
  while (resolvers.length < 5) await new Promise(resolve => setImmediate(resolve))
  resolvers[4].resolve({ok: true})
  assert.equal((await recovered).status, 200)
})

test('configuration preserves old environment names and database paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awaker-config-'))
  try {
    assert.equal(config({}, dir).db, join(dir, 'data/awaker.sqlite'))
    mkdirSync(join(dir, 'data'))
    writeFileSync(join(dir, 'data/sunday.sqlite'), '')
    assert.equal(config({}, dir).db, join(dir, 'data/sunday.sqlite'))
    const result = config({SUNDAY_ADMIN_TOKEN: owner, AWAKER_AGENT_TOKEN: agent, SUNDAY_HOST: 'old', AWAKER_HOST: 'new'}, dir)
    assert.equal(result.adminToken, owner)
    assert.equal(result.agentToken, agent)
    assert.equal(result.host, 'new')
    // A blank line copied from .env.example must not switch off a login the legacy name still sets.
    const blank = config({AWAKER_ADMIN_TOKEN: '', SUNDAY_ADMIN_TOKEN: owner, AWAKER_AGENT_TOKEN: '', SUNDAY_AGENT_TOKEN: agent, AWAKER_PUBLIC_URL: '', AWAKER_DB: ''}, dir)
    assert.equal(blank.adminToken, owner)
    assert.equal(blank.agentToken, agent)
    assert.equal(blank.publicUrl, 'http://127.0.0.1:4173')
    assert.equal(config({AWAKER_ADMIN_TOKEN: ''}, dir).adminToken, undefined)
    assert.throws(() => config({PORT: 'NaN'}, dir))
    for (const url of ['ftp://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=x']) {
      assert.throws(() => publicOrigin(url))
    }
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('setup generates private distinct tokens and refuses to overwrite configuration', async () => {
  const {copyFileSync, readFileSync, statSync} = await import('node:fs')
  const {spawnSync} = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'awaker-setup-'))
  try {
    mkdirSync(join(dir, 'scripts'))
    copyFileSync(resolve('scripts/setup.js'), join(dir, 'scripts/setup.mjs'))
    const run = () => spawnSync(process.execPath, [join(dir, 'scripts/setup.mjs')], {encoding: 'utf8'})
    assert.equal(run().status, 0)
    const content = readFileSync(join(dir, '.env'), 'utf8')
    const values = Object.fromEntries(content.trim().split('\n').map(line => line.split('=')))
    assert.match(values.AWAKER_ADMIN_TOKEN, /^[a-f0-9]{64}$/)
    assert.match(values.AWAKER_AGENT_TOKEN, /^[a-f0-9]{64}$/)
    assert.notEqual(values.AWAKER_ADMIN_TOKEN, values.AWAKER_AGENT_TOKEN)
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
    assert.equal(run().status, 1)
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), content)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('without tokens the service is open, still refuses cross-origin writes, and has nothing to sign in to', async t => {
  const {request} = await harness(t, {adminToken: undefined, agentToken: undefined})
  const settings = await request('/api/v1/settings')
  assert.equal(settings.status, 200)
  assert.equal((await settings.json()).authRequired, false)
  assert.equal((await request('/api/v1/settings', {
    method: 'PUT', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({username: 'open'})
  })).status, 200)
  // Cross-site requests are still rejected, so another page cannot drive the service.
  assert.equal((await request('/api/v1/settings', {
    method: 'PUT', headers: {Origin: 'https://evil.example', 'Content-Type': 'application/json'}, body: JSON.stringify({username: 'evil'})
  })).status, 403)
  assert.equal((await request('/api/v1/session', {
    method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({token: owner})
  })).status, 409)
})

test('one token alone is rejected, and configured tokens still gate owner routes', async t => {
  assert.throws(() => createHttpServer({
    service: {}, worker: {status: () => ({})}, adminToken: owner, agentToken: undefined, publicUrl: origin, dist: resolve('dist')
  }), /distinct/)
  const {request} = await harness(t)
  assert.equal((await request('/api/v1/settings')).status, 401)
  assert.equal((await request('/api/v1/settings', {headers: {Authorization: `Bearer ${agent}`}})).status, 403)
  assert.equal((await request('/api/v1/settings', {headers: {Authorization: `Bearer ${owner}`}})).status, 200)
})

test('a configured Sleeper account cannot be changed through the service', async t => {
  const {createService} = await import('../server/service.js')
  const data = new Map()
  const store = {get: (key, fallback) => data.has(key) ? data.get(key) : fallback, set: (key, value) => data.set(key, value)}
  const service = createService({store, provider: {}, username: 'owner-account'})
  assert.equal(service.settings().username, 'owner-account')
  assert.equal(service.usernameLocked(), true)
  assert.throws(() => service.saveSettings({username: 'someone-else'}), /set by this server/)
  // Other settings still save, and the account stays put.
  assert.equal(service.saveSettings({timezone: 'UTC'}).username, 'owner-account')
  assert.equal(service.settings().username, 'owner-account')
  // Stored settings from before the account was configured never win.
  data.set('settings', {...service.settings(), username: 'stale-account'})
  assert.equal(service.settings().username, 'owner-account')
})

test('an unexpected server fault is logged with its stack and reaches the browser only in general terms', async t => {
  const logged = []
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')))
  const {request} = await harness(t, {service: {status: async () => { throw new TypeError('reading secret internals') }}})
  const response = await request('/api/v1/status', {headers: {Authorization: `Bearer ${agent}`}})
  assert.equal(response.status, 500)
  assert.equal((await response.text()).includes('secret internals'), false)
  assert.equal(logged.length, 1)
  assert.match(logged[0], /TypeError: reading secret internals\n\s+at /)
  assert.equal(logged[0].includes(agent) || logged[0].includes(owner), false)
  // An intentional refusal carries a status and is not a fault worth logging.
  assert.equal((await request('/api/v1/settings')).status, 401)
  assert.equal(logged.length, 1)
})

test('a request for the wrong host explains which setting names the right one', async t => {
  const {request} = await harness(t)
  const response = await request('/api/v1/settings', {headers: {Host: 'localhost:4173'}})
  assert.equal(response.status, 403)
  assert.match((await response.json()).error, /AWAKER_PUBLIC_URL/)
})

test('the Python launcher keeps a configured public URL, points mcp at --port, and keeps the owner token from it', async t => {
  const {spawnSync} = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'awaker-launch-'))
  t.after(() => rmSync(dir, {recursive: true, force: true}))
  mkdirSync(join(dir, 'server'))
  // Stand-ins for the real entry points report the environment the launcher gave them.
  const report = "console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(AWAKER|SUNDAY)_/.test(k)))))"
  writeFileSync(join(dir, 'server', 'start.js'), report)
  writeFileSync(join(dir, 'server', 'mcp.js'), `export function runMcp() { ${report} }`)
  const environment = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(AWAKER|SUNDAY|NTFY)_|^PORT$/.test(k)))
  const launch = (command, envFile, overrides) => {
    const result = spawnSync(process.execPath, [resolve('src/awaker/launch.mjs'), command, dir, dir, envFile, JSON.stringify(overrides)], {env: environment, encoding: 'utf8'})
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const configured = join(dir, 'configured.env')
  writeFileSync(configured, `AWAKER_PUBLIC_URL=https://awaker.example.com\nAWAKER_ADMIN_TOKEN=${owner}\nSUNDAY_ADMIN_TOKEN=${owner}\nAWAKER_AGENT_TOKEN=${agent}\n`)
  assert.equal(launch('serve', configured, {PORT: '5000'}).AWAKER_PUBLIC_URL, 'https://awaker.example.com')
  assert.equal(launch('serve', join(dir, 'missing.env'), {PORT: '5000'}).AWAKER_PUBLIC_URL, 'http://127.0.0.1:5000')
  assert.equal(launch('serve', configured, {PORT: '5000', AWAKER_PUBLIC_URL: 'https://other.example.com'}).AWAKER_PUBLIC_URL, 'https://other.example.com')
  const mcp = launch('mcp', configured, {PORT: '5000'})
  assert.equal(mcp.AWAKER_API_URL, 'http://127.0.0.1:5000')
  assert.equal(mcp.AWAKER_AGENT_TOKEN, agent)
  assert.equal(JSON.stringify(mcp).includes(owner), false)
})

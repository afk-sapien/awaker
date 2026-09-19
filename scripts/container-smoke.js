import {httpRequest} from './http-request.js'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import assert from 'node:assert/strict'

const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8'})
const owner = randomBytes(32).toString('hex')
const agent = randomBytes(32).toString('hex')
const published = process.env.AWAKER_SMOKE_IMAGE
const selected = process.env.AWAKER_SMOKE_MODE
if (published && !['static', 'service'].includes(selected)) throw Error('Choose static or service for the published-image smoke test')
const targets = published ? [[selected, null]] : [['static', 'Dockerfile'], ['service', 'Dockerfile.service']]
for (const [mode, file] of targets) {
  const name = `awaker-smoke-${mode}-${process.pid}`
  const volume = `${name}-data`
  const image = published || `awaker-smoke:${mode}`
  console.log(`Testing ${mode} container`)
  if (file) docker('build', '-f', file, '-t', image, '.')
  else docker('pull', image)
  let id
  try {
    // The service needs the account it reports on before it will start.
    const env = ['-e', `AWAKER_ADMIN_TOKEN=${owner}`, '-e', `AWAKER_AGENT_TOKEN=${agent}`, '-e', 'SLEEPER_USERNAME=example']
    const storage = mode === 'service' ? ['-v', `${volume}:/app/data`] : []
    id = docker('run', '-d', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '-p', '127.0.0.1::4173', ...env, ...storage, image).trim()
    const port = docker('port', id, '4173/tcp').trim().split(':').at(-1)
    let url = `http://127.0.0.1:${port}`
    const headers = {Host: '127.0.0.1:4173'}
    let ready = false
    for (const attempt of Array.from({length: 60}, (_, index) => index)) {
      try {
        const response = await httpRequest(url, {headers, signal: AbortSignal.timeout(1000)})
        if (response.ok) { ready = true }
      } catch {}
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.ok(ready, 'Container did not become ready')
    const response = await httpRequest(url, {headers})
    assert.match(await response.text(), /Awaker/)
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/)
    assert.equal(docker('exec', id, 'id', '-u').trim(), '1000')
    if (mode === 'service') {
      assert.equal((await httpRequest(`${url}/api/v1/settings`, {headers})).status, 401)
      assert.equal((await httpRequest(`${url}/api/v1/settings`, {headers: {...headers, Authorization: `Bearer ${agent}`}})).status, 403)
      const admin = {...headers, Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json'}
      assert.equal((await httpRequest(`${url}/api/v1/settings`, {method: 'PUT', headers: admin, body: JSON.stringify({timezone: 'UTC'})})).status, 200)
      docker('exec', id, 'node', 'scripts/healthcheck.js')
      docker('restart', id)
      url = `http://127.0.0.1:${docker('port', id, '4173/tcp').trim().split(':').at(-1)}`
      for (const attempt of Array.from({length: 60})) {
        try {
          if ((await httpRequest(`${url}/healthz`, {headers})).ok) break
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      const settings = await httpRequest(`${url}/api/v1/settings`, {headers: admin, signal: AbortSignal.timeout(10000)}).then(response => response.json())
      assert.equal(settings.settings.timezone, 'UTC')
      assert.equal(settings.settings.username, 'example')
      // The configured account cannot be swapped through the API.
      assert.equal((await httpRequest(`${url}/api/v1/settings`, {method: 'PUT', headers: admin, body: JSON.stringify({username: 'someone-else'})})).status, 400)
    }
    console.log(`${mode} container passed`)
  } catch (error) {
    if (id) console.error(docker('logs', id))
    throw error
  } finally {
    if (id) docker('rm', '-f', id)
    if (mode === 'service') docker('volume', 'rm', volume)
  }
}

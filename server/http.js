import {createServer} from 'node:http'
import {timingSafeEqual, randomBytes} from 'node:crypto'
import {contracts, validate} from './contracts.js'
import {bad} from './settings.js'
import {publicOrigin} from './config.js'
import {json, serveStatic} from './static.js'

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const sessionCookie = req => req.headers.cookie?.split(';').map(part => part.trim())
  .find(part => part.startsWith('awaker_session='))?.slice('awaker_session='.length)

export function createHttpServer({service, worker, publish, adminToken, agentToken, publicUrl, dist, now = Date.now}) {
  if (![adminToken, agentToken].every(token => typeof token === 'string' && token.length >= 32 && /^[\x21-\x7e]+$/.test(token)) || equal(adminToken, agentToken)) {
    throw Error('Set distinct AWAKER_ADMIN_TOKEN and AWAKER_AGENT_TOKEN of at least 32 printable ASCII characters.')
  }
  const origin = publicOrigin(publicUrl)
  const sessions = new Map()
  const rates = new Map()
  let testAt = -Infinity
  const cookie = (token, maxAge) => `awaker_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`

  async function body(req) {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw bad('Content-Type must be application/json.', 415)
    }
    const chunks = []
    let size = 0
    // Do not destroy the socket before the client can receive the 413 response.
    for await (const chunk of req.iterator({destroyOnReturn: false})) {
      size += chunk.length
      if (size > 65536) throw bad('Request too large.', 413)
      chunks.push(chunk)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
    catch { throw bad('Invalid JSON.') }
  }

  function role(req) {
    // An explicit credential must never inherit owner access from a cookie.
    if (req.headers.authorization !== undefined) {
      const bearer = req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
      if (equal(bearer, adminToken)) return 'admin'
      if (equal(bearer, agentToken)) return 'agent'
      return null
    }
    const token = sessionCookie(req)
    const expires = sessions.get(token)
    if (expires > now()) return 'admin'
    sessions.delete(token)
    return null
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) throw bad('Unrecognized host.', 403)
      if (req.headers.origin && req.headers.origin !== origin) throw bad('Unrecognized origin.', 403)
      const path = new URL(req.url, origin).pathname
      if (path === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
        json(res, 200, {status: 'ok'})
        return
      }
      if (path.startsWith('/api/')) {
        const ip = req.socket.remoteAddress
        const window = Math.floor(now() / 60000)
        for (const [key, value] of rates) if (value.window !== window) rates.delete(key)
        if (!rates.has(ip) && rates.size >= 1000) throw bad('Too many requests.', 429)
        const rate = rates.get(ip) || {window, count: 0}
        rates.set(ip, rate)
        if (++rate.count > 120) {
          res.setHeader('Retry-After', '60')
          throw bad('Too many requests.', 429)
        }
        if (path === '/api/v1/session' && req.method === 'POST') {
          if (req.headers.origin !== origin) throw bad('Same-origin login required.', 403)
          const input = await body(req)
          if (!equal(input?.token, adminToken)) throw bad('Invalid owner token.', 401)
          for (const [key, until] of sessions) if (until <= now()) sessions.delete(key)
          if (sessions.size >= 100) sessions.delete(sessions.keys().next().value)
          const token = randomBytes(32).toString('hex')
          sessions.set(token, now() + 8 * 3600000)
          res.setHeader('Set-Cookie', cookie(token, 28800))
          json(res, 200, {connected: true})
          return
        }
        const auth = role(req)
        if (!auth) throw bad('Authorization required.', 401)
        if (!req.headers.authorization && req.method !== 'GET' && req.headers.origin !== origin) {
          throw bad('Same-origin request required.', 403)
        }
        const contract = contracts.find(item => path === `/api/v1${item.path}` && req.method === item.method)
        if (contract) {
          const input = validate(req.method === 'GET' ? Object.fromEntries(new URL(req.url, origin).searchParams) : await body(req), contract.inputSchema)
          json(res, 200, await service[contract.call](input))
          return
        }
        if (auth !== 'admin') throw bad('Owner access required.', 403)
        if (path === '/api/v1/session' && req.method === 'DELETE') {
          sessions.delete(sessionCookie(req))
          res.setHeader('Set-Cookie', cookie('', 0))
          json(res, 200, {connected: false})
          return
        }
        if (path === '/api/v1/settings' && req.method === 'GET') {
          json(res, 200, {settings: service.settings(), worker: worker.status()})
          return
        }
        if (path === '/api/v1/settings' && req.method === 'PUT') {
          json(res, 200, {settings: service.saveSettings(await body(req))})
          return
        }
        if (path === '/api/v1/client' && req.method === 'GET') {
          json(res, 200, await service.client())
          return
        }
        if (path === '/api/v1/refresh' && req.method === 'POST') {
          json(res, 200, await service.client(true))
          return
        }
        if (path === '/api/v1/notifications/test' && req.method === 'POST') {
          if (!publish) throw bad('Configure ntfy credentials on the server first.', 409)
          if (now() - testAt < 60000) throw bad('Wait one minute between test messages.', 429)
          testAt = now()
          await publish({type: 'test', title: 'Awaker notification test', message: 'Your Awaker notification connection is working.', url: `${origin}/integrations.html`})
          json(res, 200, {accepted: true, deviceDelivery: 'unconfirmed'})
          return
        }
        throw bad('Endpoint not found.', 404)
      }
      await serveStatic(req, res, dist, path)
    } catch (error) {
      if (!req.complete) res.setHeader('Connection', 'close')
      json(res, error.status || 500, {error: error.status ? error.message : 'Service request failed. Check provider availability or server configuration.'})
    }
  })
  server.requestTimeout = 30000
  server.headersTimeout = 15000
  return server
}

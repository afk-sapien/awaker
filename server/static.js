import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {readFile, realpath} from 'node:fs/promises'
import {resolve, extname, sep} from 'node:path'
import {bad} from './settings.js'

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' https://sleepercdn.com",
    "connect-src 'self' https://api.sleeper.app https://site.api.espn.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; ')
}

export function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  // League data is a few megabytes of repetitive JSON, and it is fetched every 45 seconds.
  const gzip = body.length > 4096 && /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] || ''))
  res.writeHead(status, {...securityHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(gzip ? {'Content-Encoding': 'gzip'} : {})})
  res.end(gzip ? gzipSync(body, {level: 4}) : body)
}

export async function serveStatic(req, res, dist, path) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD')
    throw bad('Method not allowed.', 405)
  }
  let decoded
  try { decoded = decodeURIComponent(path) } catch { throw bad('Invalid URL encoding.') }
  if (decoded.includes('\0') || decoded.split(/[\\/]/).some(part => part.startsWith('.'))) {
    throw bad('Not found.', 404)
  }
  const root = await realpath(dist)
  let filename
  try { filename = await realpath(resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded))) }
  catch { throw bad('Not found.', 404) }
  if (!filename.startsWith(root + sep)) throw bad('Not found.', 404)
  const type = types[extname(filename)]
  if (!type) throw bad('Not found.', 404)
  let file
  try { file = await readFile(filename) } catch { throw bad('Not found.', 404) }
  // Files are revalidated on every load (no-cache) and answered with 304 when unchanged, so a new release is picked up without versioned URLs.
  const gzip = compressible.has(extname(filename)) && file.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))
  const etag = `"${createHash('sha256').update(file).digest('base64url').slice(0, 27)}${gzip ? '-gz' : ''}"`
  const headers = {...securityHeaders, 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag, ...(compressible.has(extname(filename)) ? {Vary: 'Accept-Encoding'} : {})}
  const match = String(req.headers['if-none-match'] || '').split(',').map(tag => tag.trim().replace(/^W\//, ''))
  if (match.includes(etag) || match.includes('*')) { res.writeHead(304, headers); return res.end() }
  const body = gzip ? gzipCached(filename, etag, file) : file
  res.writeHead(200, {...headers, ...(gzip ? {'Content-Encoding': 'gzip'} : {}), 'Content-Length': body.length})
  res.end(req.method === 'HEAD' ? undefined : body)
}

const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'}
const compressible = new Set(['.html', '.js', '.css', '.svg', '.txt'])
const gzipped = new Map()
function gzipCached(filename, etag, file) {
  const hit = gzipped.get(filename)
  if (hit?.etag === etag) return hit.body
  const body = gzipSync(file, {level: 6})
  gzipped.set(filename, {etag, body})
  return body
}

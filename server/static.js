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
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https://sleepercdn.com",
    "connect-src 'self' https://api.sleeper.app https://site.api.espn.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; ')
}

export function json(res, status, value) {
  res.writeHead(status, {...securityHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
  res.end(JSON.stringify(value))
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
  const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png'}
  if (!types[extname(filename)]) throw bad('Not found.', 404)
  let file
  try { file = await readFile(filename) } catch { throw bad('Not found.', 404) }
  res.writeHead(200, {...securityHeaders, 'Content-Type': types[extname(filename)], 'Cache-Control': 'no-cache', 'Content-Length': file.length})
  res.end(req.method === 'HEAD' ? undefined : file)
}

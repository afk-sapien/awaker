import {existsSync} from 'node:fs'
import {resolve} from 'node:path'

// An empty value counts as unset, so a blank AWAKER_ADMIN_TOKEN= copied from .env.example
// cannot silently switch off a login that a legacy SUNDAY_ADMIN_TOKEN still configures.
export function setting(env, name) {
  return env[`AWAKER_${name}`] || env[`SUNDAY_${name}`] || undefined
}

export function publicOrigin(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw Error('Public URL must be an HTTP or HTTPS origin without credentials or a path.')
  }
  return url.origin
}

export function config(env = process.env, root = process.cwd()) {
  const port = Number(env.PORT || 4173)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT')
  const legacyDb = resolve(root, 'data/sunday.sqlite')
  return {
    host: setting(env, 'HOST') || '127.0.0.1',
    port,
    publicUrl: publicOrigin(setting(env, 'PUBLIC_URL') || `http://127.0.0.1:${port}`),
    username: env.SLEEPER_USERNAME || setting(env, 'SLEEPER_USERNAME') || '',
    adminToken: setting(env, 'ADMIN_TOKEN'),
    agentToken: setting(env, 'AGENT_TOKEN'),
    db: setting(env, 'DB') || (existsSync(legacyDb) ? legacyDb : resolve(root, 'data/awaker.sqlite'))
  }
}

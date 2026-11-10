import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {originsFor, requiredOrigins} from '../dist/origins.js'
import {applySources, securityHeaders} from '../server/static.js'
import {DASHBOARD_MODULES} from '../scripts/check.js'

const directives = Object.fromEntries(securityHeaders['Content-Security-Policy'].split('; ').map(part => {
 const [name, ...values] = part.split(' ')
 return [name, values]
}))

test('the declared origins are the three the app is known to reach',() => {
 assert.deepEqual(requiredOrigins, {
  img: ['https://sleepercdn.com'],
  connect: ['https://api.sleeper.app', 'https://site.api.espn.com'],
  service: ['https://ntfy.sh']
 })
})

test('the served policy is built from the declaration, not copied from it',() => {
 assert.deepEqual(directives['img-src'], ["'self'", ...requiredOrigins.img])
 assert.deepEqual(directives['connect-src'], ["'self'", ...requiredOrigins.connect])
 assert.equal(directives['default-src'].join(' '), "'self'", 'anything not named above is same-origin only')
 for (const name of ['script-src', 'font-src', 'form-action']) assert.deepEqual(directives[name], ["'self'"])
 for (const name of ['object-src', 'base-uri', 'frame-ancestors']) assert.deepEqual(directives[name], ["'none'"])
 // The service talks to ntfy itself, so the browser is never allowed to.
 for (const values of Object.values(directives)) assert.ok(!values.includes(requiredOrigins.service[0]), 'a service origin does not belong in the page policy')
})

// The declaration is only worth having if it is complete, so the core is read and every absolute URL
// in it has to be an origin that was declared. A new third party cannot arrive inside a module
// without the diff also touching dist/origins.js, which is the one file to read to see what the app
// talks to.
test('no core module reaches an origin that was not declared',() => {
 const declared = new Set(Object.values(requiredOrigins).flat())
 const core = readdirSync('dist').filter(name => name.endsWith('.js') && !DASHBOARD_MODULES.includes(name))
 assert.ok(core.includes('api.js') && core.includes('themes.js'), 'the core is being read')
 const found = new Set()
 for (const name of core) {
  for (const [url] of readFileSync(join('dist', name), 'utf8').matchAll(/\bhttps?:\/\/[^\s'"`)\\]+/g)) found.add(new URL(url).origin)
 }
 for (const origin of found) assert.ok(declared.has(origin), `${origin} is reached by the core but not declared in dist/origins.js`)
 assert.ok(found.size > 0, 'the search found something to check')
})

// A host that switched every source behind an origin off is reaching that origin for nothing, and
// should be able to leave it out of the policy it writes. One source still on keeps it: the origin
// goes only when the last reason to reach it does.
test('an origin leaves the declaration when the last source reaching it is switched off',() => {
 const espn = 'https://site.api.espn.com'
 assert.deepEqual(originsFor(), requiredOrigins, 'no opinion changes nothing')
 assert.deepEqual(originsFor({}), requiredOrigins)
 assert.deepEqual(originsFor({espnNews: false}), requiredOrigins, 'game status still reaches ESPN')
 assert.deepEqual(originsFor({espnScoreboard: false}), requiredOrigins, 'news still reaches ESPN')
 const off = originsFor({espnNews: false, espnScoreboard: false})
 assert.deepEqual(off.connect, ['https://api.sleeper.app'], 'Sleeper is not optional')
 assert.deepEqual(off.img, requiredOrigins.img, 'headshots come from Sleeper, not from ESPN')
 assert.ok(!JSON.stringify(off).includes(espn), 'nothing in the policy names an origin nobody reaches')
 // Off wins across a host file and the service settings here too, the same as every other read.
 assert.deepEqual(originsFor({espnNews: false}, {espnScoreboard: false}).connect, ['https://api.sleeper.app'])
 assert.deepEqual(originsFor({espnNews: false}, {espnNews: true, espnScoreboard: false}).connect, ['https://api.sleeper.app'])
})

// The realistic way a third party arrives in a page like this one is a tag in the HTML rather than
// an import, and nothing above would see it.
test('no shipped page loads code or styling from another origin',() => {
 for (const name of readdirSync('dist').filter(name => name.endsWith('.html'))) {
  const html = readFileSync(join('dist', name), 'utf8')
  for (const [tag, url] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
   assert.ok(!/^(?:[a-z]+:)?\/\//i.test(url), `dist/${name} loads ${url} from another origin: ${tag}`)
  }
 }
})

// Last, because it is the one test here that changes what the service is serving. The service reads
// the owner's switches at startup and again on every save, so a request that slipped past a switch
// is refused by the browser rather than sent quietly.
test('the served policy is rewritten when the owner switches a source off',() => {
 const espn = 'https://site.api.espn.com', served = () => securityHeaders['Content-Security-Policy']
 const before = served()
 assert.ok(before.includes(espn), 'both ESPN sources are on by default')
 applySources({espnNews: false})
 assert.ok(served().includes(espn), 'game status still reaches it')
 applySources({espnNews: false, espnScoreboard: false})
 assert.ok(!served().includes(espn), 'nothing reaches it, so the browser is not allowed to either')
 assert.ok(served().includes('https://api.sleeper.app'), 'and the rest of the policy is untouched')
 applySources({})
 assert.equal(served(), before, 'switched back on, the policy is the one it started with')
})

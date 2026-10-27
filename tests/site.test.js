import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {DEFAULT_SITE, MARKERS, SITE_FILE, injectHtml, loadSiteFile, siteConfig} from '../dist/site.js'

const pages = readdirSync('dist').filter(name => name.endsWith('.html'))
const page = (head = '', body = '') => `<!doctype html><html lang="en"><head><!--${MARKERS.headStart}--><meta charset="UTF-8"><title>Awaker · Fantasy HQ</title>${head}<!--${MARKERS.headEnd}--></head><body><div class="brand">awaker／</div><span>AWAKER HQ</span><p>Loading Awaker…</p>${body}<!--${MARKERS.bodyEnd}--></body></html>`

test('every shipped page carries all three markers',() => {
 assert.ok(pages.length >= 2, 'both pages are being read')
 for (const name of pages) {
  const html = readFileSync(join('dist', name), 'utf8')
  for (const marker of Object.values(MARKERS)) assert.ok(html.includes(`<!--${marker}-->`), `dist/${name} is missing <!--${marker}-->`)
  assert.doesNotThrow(() => injectHtml(html, {head: '<meta name="x" content="y">', body: '<footer>x</footer>'}), `dist/${name} can be injected into`)
 }
})

test('head and body are injected just inside their closing tags',() => {
 const out = injectHtml(page(), {head: '<meta name="robots" content="noindex">', body: '<footer id="site">Site</footer>'})
 assert.match(out, /<meta name="robots" content="noindex"><!--awaker:head-end--><\/head>/)
 assert.match(out, /<footer id="site">Site<\/footer><!--awaker:body-end--><\/body>/)
 assert.equal(injectHtml(page()), page(), 'injecting nothing changes nothing')
})

test('a page with a marker missing is an error naming the marker',() => {
 for (const marker of Object.values(MARKERS)) {
  const broken = page().replace(`<!--${marker}-->`, '')
  let error = null
  try { injectHtml(broken, {head: '<meta name="x" content="y">'}) } catch (thrown) { error = thrown }
  assert.ok(error, `a page without <!--${marker}--> must not inject silently`)
  assert.equal(error.name, 'MissingMarkerError')
  assert.equal(error.marker, marker)
  assert.match(error.message, new RegExp(marker))
 }
 assert.throws(() => injectHtml(null), /needs the page as a string/)
})

test('the title and the brand are replaced, and the markers are not',() => {
 const out = injectHtml(page(), {title: 'Sunday HQ · Scores', name: 'WideAwake'})
 assert.match(out, /<title>Sunday HQ · Scores<\/title>/)
 assert.match(out, /<div class="brand">wideawake／<\/div>/, 'the sidebar writes the brand in lower case')
 assert.match(out, /<span>WIDEAWAKE HQ<\/span>/, 'and the eyebrow in upper case')
 assert.match(out, /Loading WideAwake…/, 'and prose as given')
 assert.ok(!/awaker/i.test(out.replace(/<!--[^>]*-->/g, '')), 'no occurrence of the old name is left in the page')
 for (const marker of Object.values(MARKERS)) assert.ok(out.includes(`<!--${marker}-->`), 'the markers survive a rename, so a page can be wrapped again')
 assert.equal(injectHtml(out, {}), out)
})

test('a name or title that would break the page is refused, and injected markup is left alone',() => {
 for (const bad of ['', '   ', 42, null]) {
  assert.throws(() => injectHtml(page(), {name: bad}), /app name must be a string/)
  assert.throws(() => injectHtml(page(), {title: bad}), /page title must be a string/)
 }
 const out = injectHtml(page(), {name: '<script>x</script>', title: 'A & B'})
 assert.ok(!out.includes('<script>x</script>'), 'a name is escaped before it is written into the page')
 assert.match(out, /<title>A &amp; B<\/title>/)
 const kept = injectHtml(page(), {name: 'WideAwake', body: '<p>awaker built this</p>'})
 assert.match(kept, /<p>awaker built this<\/p>/, 'what the caller passes in is never rewritten')
})

test('the site config carries a name and links, and nothing else survives it',() => {
 assert.deepEqual(siteConfig(null), DEFAULT_SITE, 'no file means today’s defaults')
 for (const nothing of [undefined, 'a string', [], 42, {name: ''}, {name: '   '}, {name: 'x'.repeat(41)}, {name: 7}]) {
  assert.deepEqual(siteConfig(nothing), DEFAULT_SITE, JSON.stringify(nothing) + ' is not a config')
 }
 assert.deepEqual(siteConfig({name: '  Sunday HQ  '}), {name: 'Sunday HQ', links: []})
 assert.deepEqual(siteConfig({
  name: 'Sunday HQ',
  links: [{label: ' About ', href: '/about'}, {label: 'Blog', href: 'https://example.com/blog'}, {label: 'Home', href: '/'}]
 }), {name: 'Sunday HQ', links: [{label: 'About', href: '/about'}, {label: 'Blog', href: 'https://example.com/blog'}, {label: 'Home', href: '/'}]})

 // Everything a link could be that is not a page on this site or an https address.
 for (const href of ['javascript:alert(1)', 'data:text/html,x', '//example.com', 'http://example.com', '\\\\example.com', 'about', '', 42, null]) {
  assert.deepEqual(siteConfig({links: [{label: 'Bad', href}]}).links, [], JSON.stringify(href) + ' is not a link')
 }
 assert.deepEqual(siteConfig({links: [{href: '/x'}, {label: 'No href'}, 'nope', null, {label: 'x'.repeat(41), href: '/x'}]}).links, [])
 assert.equal(siteConfig({links: Array.from({length: 20}, (_, i) => ({label: `L${i}`, href: `/l${i}`}))}).links.length, 6, 'a footer is not a sitemap')

 // The scope limit, kept by the shape of what comes out: anything else in the file is dropped.
 const extra = siteConfig({name: 'Sunday HQ', script: 'https://example.com/a.js', analytics: {id: 'x'}, siteId: 'abc', links: [{label: 'A', href: '/a', onclick: 'x'}]})
 assert.deepEqual(Object.keys(extra), ['name', 'links'])
 assert.deepEqual(Object.keys(extra.links[0]), ['label', 'href'])
})

test('the site file is optional, same origin, and never breaks the page',async () => {
 const original = globalThis.fetch
 let answer = null
 globalThis.location = {href: 'http://127.0.0.1:4173/', origin: 'http://127.0.0.1:4173'}
 const asked = []
 globalThis.fetch = async (url, options) => {
  asked.push({url: String(url), ...options})
  if (answer === null) return new Response('', {status: 404})
  return new Response(answer)
 }
 try {
  assert.deepEqual(await loadSiteFile(), DEFAULT_SITE, 'no file is the normal case')
  assert.equal(asked[0].url, `http://127.0.0.1:4173/${SITE_FILE}`)
  assert.equal(asked[0].redirect, 'error', 'a redirect elsewhere is not followed')
  assert.equal(asked[0].credentials, 'omit')

  answer = JSON.stringify({name: 'Sunday HQ', links: [{label: 'About', href: '/about'}]})
  assert.deepEqual(await loadSiteFile(), {name: 'Sunday HQ', links: [{label: 'About', href: '/about'}]})

  // A static host that answers an unknown path with a page of HTML is the case the old settings
  // probe only survived because its catch was empty.
  for (const body of ['<!doctype html><title>Not found</title>', '', 'null', '[]', '{"name":']) {
   answer = body
   assert.deepEqual(await loadSiteFile(), DEFAULT_SITE, JSON.stringify(body.slice(0, 20)))
  }
  answer = JSON.stringify({name: 'Sunday HQ', padding: 'x'.repeat(5000)})
  assert.deepEqual(await loadSiteFile(), DEFAULT_SITE, 'a file this big is not the config')

  globalThis.fetch = async () => { throw TypeError('offline') }
  assert.deepEqual(await loadSiteFile(), DEFAULT_SITE, 'a failed request is not an error')
  globalThis.location = {href: 'http://127.0.0.1:4173/', origin: 'https://awaker.example'}
  globalThis.fetch = async () => { throw Error('no request should be made') }
  assert.deepEqual(await loadSiteFile(), DEFAULT_SITE, 'the file is never read across origins')
  delete globalThis.location
  assert.deepEqual(await loadSiteFile(), DEFAULT_SITE, 'there is no page to read it from in Node')
 } finally {
  globalThis.fetch = original
  delete globalThis.location
 }
})

test('a page says it is on a static host and the boot script reads it',async () => {
 globalThis.window = {addEventListener() {}}
 globalThis.document = {
  querySelector: selector => selector === 'meta[name="awaker:mode"]' ? {content: 'static'} : null,
  getElementById: () => ({textContent: ''}),
  addEventListener() {}
 }
 try {
  await import('../dist/boot.js')
  assert.equal(globalThis.window.awaker.staticMode, true)
  const {S} = await import('../dist/ui/state.js')
  assert.equal(S.staticMode, false, 'and a page that says nothing is not static')
  assert.deepEqual(S.site, DEFAULT_SITE)
 } finally {
  delete globalThis.window
  delete globalThis.document
 }
})

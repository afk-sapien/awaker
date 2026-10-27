import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {MARKERS, injectHtml} from '../dist/site.js'

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

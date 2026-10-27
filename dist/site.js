// Anything that wraps this dashboard in a site of its own has to put its own tags in the head and
// its own markup at the end of the body. Searching the page for </head>, or for the charset meta, or
// for the title, breaks on any unrelated edit to it, and breaks quietly: the search finds nothing,
// nothing is inserted, and the page ships looking almost right.
//
// So the pages carry comment markers, this is the only thing that reads them, and a marker that goes
// missing is an error here rather than a surprise in the output.
export const MARKERS = {headStart: 'awaker:head-start', headEnd: 'awaker:head-end', bodyEnd: 'awaker:body-end'}

const comment = marker => `<!--${marker}-->`
const missingMarker = marker => Object.assign(
  Error(`The page carries no ${comment(marker)}, so there is nowhere to inject. A dist page lost its markers.`),
  {name: 'MissingMarkerError', marker}
)
const escaped = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
const text = (value, what) => {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${what} must be a string with something in it.`)
  return escaped(value.trim())
}
const insert = (html, marker, part) => {
  const at = html.indexOf(comment(marker))
  if (at === -1) throw missingMarker(marker)
  return html.slice(0, at) + part + html.slice(at)
}

// The brand is written three ways, as Awaker in prose, awaker in the sidebar and AWAKER in one
// eyebrow, so a rename keeps the case of each occurrence. The markers are the one place the word is
// not the brand, so they are skipped and survive a rename.
export const rename = (value, name) => String(value).replace(/awaker(?!:)/gi, match =>
  match === match.toUpperCase() ? name.toUpperCase() : match[0] === match[0].toLowerCase() ? name.toLowerCase() : name)

// head goes just inside </head>, body just inside </body>. title replaces what the page's title
// says. name renames the brand throughout. The markers stay in the result, so a page can be
// wrapped again.
export function injectHtml(html, {head = '', body = '', title, name} = {}) {
  if (typeof html !== 'string') throw Error('injectHtml needs the page as a string.')
  for (const marker of Object.values(MARKERS)) if (!html.includes(comment(marker))) throw missingMarker(marker)
  let out = html
  if (name !== undefined) out = rename(out, text(name, 'The app name'))
  if (title !== undefined) out = out.replace(/<title>[^<]*<\/title>/, `<title>${text(title, 'The page title')}</title>`)
  // Injected last, so nothing the caller passes in is rewritten by the brand or title replacement.
  return insert(insert(out, MARKERS.bodyEnd, body), MARKERS.headEnd, head)
}

// dist/site.json, if whoever is hosting this writes one. A name and a list of links, and
// deliberately nothing else: no script to load, no origin to add, no identifier, nothing that turns
// a page nobody is being measured on into one they are. Adding any of that would have to get past
// tests/origins.test.js, which is the point.
//
// The file is read field by field and anything wrong is replaced by the default, so a typo in one
// link cannot take the page down. A link is either a path on this origin or an https URL: no
// javascript:, no data:, and no protocol-relative //host, which would silently be another site.
export const DEFAULT_SITE = {name: 'Awaker', links: []}
export const SITE_FILE = 'site.json'
const short = (value, limit) => typeof value === 'string' && value.trim() && value.trim().length <= limit ? value.trim() : null
const safeHref = value => {
  const href = short(value, 200)
  return href && (href === '/' || /^\/[^/\\]/.test(href) || /^https:\/\/[^\s/\\]+(?:\/|$)/.test(href)) ? href : null
}
export function siteConfig(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const links = []
  for (const row of Array.isArray(input.links) ? input.links.slice(0, 6) : []) {
    const label = row && typeof row === 'object' ? short(row.label, 40) : null
    const href = row && typeof row === 'object' ? safeHref(row.href) : null
    if (label && href) links.push({label, href})
  }
  return {name: short(input.name, 40) || DEFAULT_SITE.name, links}
}

// Optional, same origin, and small. Every way it can fail ends in today's defaults, including the
// static host that answers an unknown path with 200 and a page of HTML: that parses as nothing and
// is treated as no file at all, rather than relying on an exception being swallowed somewhere.
export async function loadSiteFile() {
  if (typeof location === 'undefined' || !location?.href) return siteConfig(null)
  let url
  try { url = new URL(SITE_FILE, location.href) } catch { return siteConfig(null) }
  if (url.origin !== location.origin) return siteConfig(null)
  let response
  try { response = await fetch(url.href, {redirect: 'error', credentials: 'omit'}) } catch { return siteConfig(null) }
  if (!response.ok) { try { await response.body?.cancel() } catch {} return siteConfig(null) }
  try {
    const body = await response.text()
    return siteConfig(body.length > 4096 ? null : JSON.parse(body))
  } catch { return siteConfig(null) }
}

// Player news on the page: one strip for a roster, one section inside a player's profile.
//
// The reading is all done by dist/news.js, which the service and an agent call too, so this file
// only fetches the feed once, keeps it in S.news, and writes the result out as markup. Every string
// it prints came from a provider, so every one of them goes through esc, and a link is only ever the
// one dist/news.js already checked.
import * as api from '../api.js'
import {createMemo, identity} from '../cache.js'
import {readNews} from '../news.js'
import {SOURCES, sourceEnabled} from '../sources.js'
import {S} from './state.js'
import {esc, playerLink, pname} from './core.js'

const TEN_MINUTES = 600000
// Enabled is both switches read together, and off wins: a static host says it in site.json and a
// service says it in its settings. The demo has invented players, so a real headline could only
// attach to them by accident, and no request is made for a page that is only showing a sample.
export const newsEnabled = () => !S.data?.demo && sourceEnabled('espnNews', S.site?.sources, S.serviceSettings?.sources)

// One fetch, shared by everything on the page. It resolves when S.news has settled, and the caller
// redraws: this module never calls render, so it can be used from inside the dialog as well.
export function ensureNews(force = false) {
  if (!newsEnabled()) {
    S.news = {state: 'off', feed: null, at: null}
    return Promise.resolve(S.news)
  }
  if (!force) {
    if (S.news?.pending) return S.news.pending
    if (S.news?.feed && Date.now() - S.news.at < TEN_MINUTES) return Promise.resolve(S.news)
  }
  const pending = api.news({force})
    .then(feed => (S.news = {state: 'ready', feed, at: Date.now()}))
    .catch(() => (S.news = {state: 'error', feed: null, at: null}))
  // The feed already in hand stays readable while the next one is in flight.
  S.news = {state: S.news?.feed ? 'ready' : 'loading', feed: S.news?.feed ?? null, at: S.news?.at ?? null, pending}
  return pending
}

// Rendering happens on every keystroke in the watchroom search box, so the read is memoised against
// the three things it depends on: the feed, the directory, and the players asked about.
const reads = createMemo(8)
// One object stands in for a feed that is not there, so a page with the source off still hits the
// memo rather than reading the whole roster again on every keystroke.
const NOTHING = {}
export function newsFor(ids, limit = 24) {
  const list = [...ids].map(String)
  // The switch is part of the key: turning the source off has to change the answer, not be served
  // the one read before it.
  const on = newsEnabled()
  const key = JSON.stringify([identity(S.news?.feed ?? NOTHING), identity(S.data?.players ?? NOTHING), on, limit, list])
  return reads.get(key, () => readNews({
    players: S.data?.players || {}, feed: S.news?.feed || null, ids: list, limit,
    sources: {espnNews: on}, fetchedAt: S.news?.at ?? null
  }))
}

export function ago(at, now = Date.now()) {
  if (!Number.isFinite(at)) return ''
  const minutes = Math.round((now - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days <= 7 ? `${days}d ago` : new Date(at).toLocaleDateString([], {month: 'short', day: 'numeric'})
}
const stamp = at => Number.isFinite(at) ? `<time datetime="${esc(new Date(at).toISOString())}">${esc(ago(at))}</time>` : ''

const conditionLine = state => [state.status || state.roster, state.bodyPart].filter(Boolean)
  .map((part, i) => i === 0 ? `<span class="injury injury-${esc(state.tone || 'other')}">${esc(part)}</span>` : `<strong>${esc(part)}</strong>`)
  .join(' ') || '<strong>Condition noted</strong>'

// A name match is reported on the item itself rather than in a footnote, because it is the one place
// where this feed can be about a different man than the one it is filed under.
const matchNote = item => item.match === 'name' ? ' · <span class="muted">matched by name</span>' : ''

function itemHTML(item, {names = false} = {}) {
  const who = names && item.players.length ? `<span class="news-who">${item.players.map(id => playerLink(id)).join(' ')}</span>` : ''
  if (item.kind === 'condition') {
    const state = item.condition
    return `<li class="news-item news-condition">${who}<p class="news-head">${conditionLine(state)}</p>
     ${state.notes ? `<p class="news-note">${esc(state.notes)}</p>` : ''}${state.practice ? `<p class="news-note">${esc(state.practice)}</p>` : ''}
     <p class="news-meta">${esc(SOURCES.sleeper.name)}${Number.isFinite(state.updatedAt) ? ' · ' + stamp(state.updatedAt) : ''}</p></li>`
  }
  return `<li class="news-item">${who}<p class="news-head"><a href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.headline)} ↗</a></p>
   <p class="news-meta">${stamp(item.published)} · ${esc(item.source)}${item.category ? ' · ' + esc(item.category) : ''}${matchNote(item)}</p></li>`
}

// Why a reader is looking at no headlines. Each case says what to do about it, and none of them is an
// error: a deployment without ESPN's permission is meant to look like this.
function sourceNote(read) {
  if (S.data?.demo) return 'Headlines are off in the demo. Connect Sleeper to see real news.'
  if (!newsEnabled()) return 'League headlines are switched off for this site. Player condition still comes from Sleeper.'
  if (S.news?.state === 'loading') return 'Loading headlines…'
  if (S.news?.state === 'error') return 'ESPN headlines could not be loaded. Player condition still comes from Sleeper.'
  const at = read.sources.find(s => s.key === 'espnNews')?.fetchedAt
  return `Headlines from ESPN${Number.isFinite(at) ? `, ${ago(at)}` : ''}. Condition from the Sleeper player record. Headline and link only.`
}

// Inside the player profile. The condition comes from the directory the page already has, so this
// section says something useful with every other source off.
export function playerNewsHTML(id) {
  const read = newsFor([id], 20), entry = read.players[String(id)]
  const items = read.items.filter(item => item.players.includes(String(id)))
  // Where the feed says the designation may have moved, the owner is the only one who can settle it,
  // so the offer to write a correction sits on that note. The button is a data attribute rather than
  // an import, so this module stays clear of the editor.
  const moved = entry?.mayHaveMoved
    ? `<p class="news-note attention">A headline below is newer than Sleeper’s record for ${esc(pname(id))}, so the designation above may have moved. <button type="button" class="inline-btn" data-override-open="${esc(id)}">Correct it yourself</button></p>`
    : ''
  return `<section class="player-news"><h3>News and condition</h3>
   ${items.length ? `<ul class="news-list">${items.map(item => itemHTML(item)).join('')}</ul>` : '<p class="muted small">No designation on file and no recent headline naming this player.</p>'}
   ${moved}<p class="muted small">${esc(sourceNote(read))}</p></section>`
}

// In the watchroom, under the players, the way score activity sits there: closed by default, and a
// summary that is worth reading without opening it.
export function rosterNewsHTML(ids) {
  const read = newsFor(ids, 24)
  const concerns = read.items.filter(item => item.kind === 'condition' && ['out', 'doubtful', 'questionable'].includes(item.condition.tone))
  const articles = read.items.filter(item => item.kind === 'article')
  const summary = concerns.length || articles.length
    ? `${concerns.length} player${concerns.length === 1 ? '' : 's'} with a designation · ${articles.length} headline${articles.length === 1 ? '' : 's'}${concerns[0] ? ` · ${esc(pname(concerns[0].players[0]))} ${esc(concerns[0].condition.status || concerns[0].condition.roster || '')}` : ''}`
    : 'Player news · Nothing on your players right now'
  return `<details class="news-strip"><summary>${summary}</summary><div>
   ${read.items.length ? `<ul class="news-list">${read.items.slice(0, 20).map(item => itemHTML(item, {names: true})).join('')}</ul>` : '<p>No designations on your rosters and no headlines naming your players.</p>'}
   <p class="muted small">${esc(sourceNote(read))}</p></div></details>`
}

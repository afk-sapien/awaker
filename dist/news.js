// Player news, read once, for the page and for an agent.
//
// Two sources, and they are not equal. Sleeper's own player record carries the condition: the
// designation, the body part, a note, and when Sleeper last touched the record. That is the base and
// it is always on, because it arrives with the player directory the app already fetches, so it works
// with every other source switched off. ESPN's league news feed is the second source and sits behind
// a switch, because ESPN grants nothing in public and each deployment has to decide for itself.
// Nothing but the headline, the source, the time and a link is taken from it: no article body is
// stored, shown or returned.
//
// Joining an ESPN article to a Sleeper player is the whole trick, and it was measured rather than
// assumed, against the live feed and Sleeper's directory on 10 November 2026.
//
// ESPN tags articles with its own athlete ids, and Sleeper carries espn_id, so that is the first key:
// exact, and never the wrong man. On its own it is not enough. Sleeper leaves espn_id null for most
// current players, 225 of the 907 who are on a team, so the id alone matched 32 of the 119 athletes
// the feed tagged, and missed James Cook and Puka Nacua. A normalised full name resolves 71 more, and
// it is safe here for a reason that is checked rather than hoped for: among the players who can hold
// a roster spot, on a team, not inactive, at a fantasy position, no two share a normalised name, so a
// single hit is the only hit. 103 of 119 resolved that way. The 16 left over are linebackers,
// safeties and a broadcaster, who are nobody's fantasy problem. Every item records which key found
// it, so a name match can be told from an id match everywhere, including by an agent.
//
// Everything here is data from a provider, so it is treated as data: strings are trimmed and capped,
// links are allowed only to ESPN over https, times must be real times, and nothing is ever returned
// as markup.

// Sleeper is the base and ESPN sits behind a switch. The switches themselves live in sources.js,
// because game status is behind one too and whoever is deciding what this deployment reaches should
// find one list rather than two. A switch can only turn a source off: see siteConfig in site.js for
// why nothing can be turned on by a file on the host.
import {NEWS_SOURCES, SOURCES, sourceEnabled} from './sources.js'

const LIMITS = {headline: 200, part: 60, note: 240, name: 80}
// The two providers spell one team differently. Washington is ESPN's WSH and Sleeper's WAS, and every
// other abbreviation agreed when the whole league was compared, so this is the one entry needed.
const TEAM_ALIASES = {WSH: 'WAS'}
const text = (value, limit = LIMITS.part) => {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, limit) : null
}
// Sleeper sends news_updated in milliseconds and injury_start_date as a date, so both are read.
const when = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000
  const parsed = Date.parse(typeof value === 'string' ? value : '')
  return Number.isFinite(parsed) ? parsed : null
}
// ESPN's own article links are kept, and nothing else is. One of the fifty measured came back over
// http, so the scheme is decided here rather than taken from the feed.
export function articleLink(value) {
  let url
  try { url = new URL(String(value)) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  if (url.hostname !== 'espn.com' && !url.hostname.endsWith('.espn.com')) return null
  url.protocol = 'https:'
  return url.href.slice(0, 500)
}

// A.J. Brown and AJ Brown are one player, so runs of single letters are joined. Jr, Sr and the
// generational numerals are dropped, because one side carries them and the other often does not.
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])
export function normaliseName(value) {
  const parts = String(value ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ')
    .filter(part => part && !SUFFIXES.has(part))
  const joined = []
  for (const part of parts) {
    if (part.length === 1 && joined.length && joined.at(-1).single) joined.at(-1).value += part
    else joined.push({value: part, single: part.length === 1})
  }
  return joined.map(part => part.value).join(' ')
}

// On a team and not retired, whatever the position: an IDP league rosters linebackers and defensive
// backs, and a headline about one of them is as much that league's news as a quarterback's. Narrowing
// to the usual offensive positions costs those leagues their news, and widening costs almost nothing:
// over the live directory the pool goes from 907 to 2747 players and nine normalised names come to be
// held by two men, who lose only the name join, never the id join or their condition.
const rosterable = player => !!player && !!player.team && player.active !== false

// One index per player directory. The directory object is replaced when it changes and kept when it
// does not, which is what every other cache in the app keys on, so the same trick works here.
const indexes = new WeakMap()
export function playerIndex(players) {
  if (!players || typeof players !== 'object') return {byEspnId: new Map(), byName: new Map()}
  const held = indexes.get(players)
  if (held) return held
  const byEspnId = new Map(), byName = new Map(), teamOf = new Map()
  for (const [id, player] of Object.entries(players)) {
    if (!rosterable(player)) continue
    if (player.espn_id != null && !byEspnId.has(String(player.espn_id))) byEspnId.set(String(player.espn_id), id)
    teamOf.set(id, String(player.team).toUpperCase())
    const name = normaliseName(player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' '))
    if (!name) continue
    // A name held by two rosterable players identifies neither, so it is dropped rather than guessed.
    byName.set(name, byName.has(name) ? null : id)
  }
  const index = {byEspnId, byName, teamOf}
  indexes.set(players, index)
  return index
}
// A name join is the one join in the app that can quietly point at the wrong man, so where ESPN says
// which team an article is about, the man found by name has to play for one of them. ESPN carries no
// team on the athlete tag itself, only separate team categories on the article, so this is silent for
// the articles that carry none: of 128 athlete tags measured over one day, 56 came from an article
// with a team tag and 55 of those agreed with Sleeper, none disagreed, and 72 had no team tag at all.
// An id join is not checked. The id is ESPN's own key for the player and a trade mid-week would
// otherwise throw away the join that is certain.
export function resolveAthlete(index, {espnId, name} = {}, {teams = null} = {}) {
  if (espnId != null && index.byEspnId.has(String(espnId))) return {id: index.byEspnId.get(String(espnId)), match: 'id'}
  const found = index.byName.get(normaliseName(name))
  if (!found) return null
  if (teams?.length && !teams.includes(index.teamOf.get(found))) return null
  return {id: found, match: 'name'}
}

// How likely he is to play, in the three words the rest of the app already uses. NA is Sleeper's
// "no designation given", which says nothing about availability, so it is not reported as a tone.
const TONES = {Out: 'out', IR: 'out', PUP: 'out', DNR: 'out', Sus: 'out', Doubtful: 'doubtful', Questionable: 'questionable', COV: 'questionable'}
export const conditionTone = status => TONES[status] || (status ? 'other' : null)

// The player's own condition, from the record the app already holds. Null when there is nothing to
// say, which is the ordinary case: 293 of 3317 fantasy players carried a designation when measured.
export function condition(player) {
  if (!player || typeof player !== 'object') return null
  const status = text(player.injury_status, 24)
  const place = text(player.status, 40)
  const roster = place && place !== 'Active' ? place : null
  const bodyPart = text(player.injury_body_part)
  const notes = text(player.injury_notes, LIMITS.note)
  const practice = [text(player.practice_participation), text(player.practice_description, LIMITS.note)]
    .filter(Boolean).join(': ') || null
  const updatedAt = when(player.news_updated)
  if (!status && !roster && !bodyPart && !notes && !practice) return null
  return {status: status || null, roster, bodyPart, notes, practice, since: when(player.injury_start_date), updatedAt, tone: conditionTone(status)}
}
// A headline for the machine shape, built from the fields rather than from anyone's prose.
export const conditionHeadline = state => [state.status || state.roster, state.bodyPart].filter(Boolean).join(' · ') || 'Condition noted'

// One ESPN payload, normalised. Articles with no usable link or time are dropped: a headline nobody
// can follow up is not news. Athlete ids travel with the item and are resolved by the caller.
export function espnArticles(feed, {limit = 50} = {}) {
  const rows = feed && Array.isArray(feed.articles) ? feed.articles : []
  const items = []
  for (const row of rows.slice(0, limit)) {
    if (!row || typeof row !== 'object') continue
    const headline = text(row.headline, LIMITS.headline)
    const published = when(row.published) ?? when(row.lastModified)
    const link = articleLink(row.links?.web?.href)
    if (!headline || !published || !link) continue
    const athletes = [], teams = []
    for (const category of Array.isArray(row.categories) ? row.categories : []) {
      if (!category) continue
      if (category.type === 'team') {
        const abbr = text(category.team?.abbreviation, 8)
        const upper = abbr ? abbr.toUpperCase() : null
        const team = upper ? TEAM_ALIASES[upper] || upper : null
        if (team && !teams.includes(team)) teams.push(team)
        continue
      }
      if (category.type !== 'athlete') continue
      const espnId = category.athlete?.id ?? category.athleteId
      const name = text(category.athlete?.description ?? category.description, LIMITS.name)
      if (espnId != null || name) athletes.push({espnId: espnId == null ? null : String(espnId), name})
    }
    // ESPN sends the article id as a number, and an article without one is identified by its link,
    // which the feed always carries and which is unique per article anyway.
    const key = ['number', 'string'].includes(typeof row.id) ? String(row.id)
      : ['number', 'string'].includes(typeof row.nowId) ? String(row.nowId) : link
    items.push({id: `espn:${key.slice(0, 120)}`, kind: 'article', source: SOURCES.espnNews.name,
      category: text(row.type, 40), headline, published, link, athletes, teams})
  }
  return items
}

// The one read. Conditions for the players asked about, articles for the players they could be about,
// and a flag where an article is newer than the condition it might already have moved.
//
// ids names the players in play, a roster or one profile. Conditions are reported for those players,
// because a condition is about a player rather than about the news, and an article is reported when
// it resolves to one of them. With no ids, every player an article resolves to is reported, which is
// what a league-wide read wants.
export function readNews({players = {}, feed = null, ids = null, now = Date.now(), limit = 60, sources = null, fetchedAt = null} = {}) {
  const espnOn = sourceEnabled('espnNews', sources)
  const wanted = ids == null ? null : new Set([...ids].filter(id => id != null).map(String))
  const index = playerIndex(players)
  const articles = [], conditions = [], byPlayer = new Map()
  const note = (id, itemId) => {
    if (!byPlayer.has(id)) byPlayer.set(id, {condition: null, conditionUpdatedAt: null, items: [], mayHaveMoved: false})
    if (itemId) byPlayer.get(id).items.push(itemId)
    return byPlayer.get(id)
  }
  // Counted per tag rather than per athlete: it is a measure of how much of the feed goes unused.
  let unresolved = 0, from = null, to = null
  if (espnOn && feed) {
    for (const article of espnArticles(feed)) {
      const matched = new Map()
      for (const athlete of article.athletes) {
        const hit = resolveAthlete(index, athlete, {teams: article.teams})
        if (!hit) { unresolved++; continue }
        if (!matched.has(hit.id)) matched.set(hit.id, hit.match)
      }
      from = from === null ? article.published : Math.min(from, article.published)
      to = to === null ? article.published : Math.max(to, article.published)
      const mine = [...matched.keys()].filter(id => !wanted || wanted.has(id))
      if (!mine.length) continue
      // The team tags did their work in the join. They are not carried onto the item, which says who
      // the news is about rather than what ESPN filed it under.
      const {athletes, teams, ...rest} = article
      articles.push({...rest, players: mine, match: mine.every(id => matched.get(id) === 'id') ? 'id' : 'name',
        matchedBy: Object.fromEntries(mine.map(id => [id, matched.get(id)]))})
      for (const id of mine) note(id, article.id)
    }
  }
  // Conditions last, so a player an article found gets his condition too, and first in the order below.
  for (const id of wanted ? [...wanted] : [...byPlayer.keys()]) {
    const state = condition(players[id])
    if (!state) continue
    const entry = note(id, null)
    entry.condition = state
    entry.conditionUpdatedAt = state.updatedAt
    const itemId = `condition:${id}`
    entry.items.unshift(itemId)
    conditions.push({id: itemId, kind: 'condition', source: SOURCES.sleeper.name, category: state.status || state.roster || 'Condition',
      headline: conditionHeadline(state), published: state.updatedAt ?? now, link: null, players: [id], match: 'id',
      matchedBy: {[id]: 'id'}, condition: state})
  }
  // An article about him that is newer than the record is the only warning available that a 24 hour
  // old designation has already moved, so it is carried rather than left for a reader to notice.
  for (const [id, entry] of byPlayer) {
    const newest = articles.filter(item => item.players.includes(id)).map(item => item.published)
    entry.mayHaveMoved = !!entry.condition && newest.length > 0 &&
      (entry.conditionUpdatedAt == null || Math.max(...newest) > entry.conditionUpdatedAt)
  }
  // The cap is on the articles, never on the conditions. A whole roster of designations would
  // otherwise push every headline out of a list asked for by a reader looking at the headlines, and a
  // condition is bounded anyway: one per player asked about, at most.
  const ranked = {out: 0, doubtful: 1, questionable: 2, other: 3}
  conditions.sort((a, b) => (ranked[a.condition.tone] ?? 4) - (ranked[b.condition.tone] ?? 4) || b.published - a.published)
  articles.sort((a, b) => b.published - a.published)
  const kept = [...conditions, ...articles.slice(0, Math.max(1, limit))], keptIds = new Set(kept.map(item => item.id))
  // A player's list points into the items that are actually returned, so a cap cannot leave a
  // reference to an item nobody can read.
  for (const entry of byPlayer.values()) entry.items = entry.items.filter(id => keptIds.has(id))
  return {
    generatedAt: now,
    // The news sources only. Game status is switched in the same place but is not news, and a read
    // that reported it would be claiming to have looked somewhere it never looks.
    sources: NEWS_SOURCES.map(key => ({key, name: SOURCES[key].name, description: SOURCES[key].description,
      enabled: sourceEnabled(key, sources), fetchedAt: key === 'espnNews' ? fetchedAt : null,
      available: key === 'espnNews' ? espnOn && !!feed : true})),
    items: kept,
    players: Object.fromEntries([...byPlayer].map(([id, entry]) => [id, entry])),
    counts: {articles: kept.filter(item => item.kind === 'article').length,
      conditions: kept.filter(item => item.kind === 'condition').length,
      players: byPlayer.size, unresolvedTags: unresolved},
    window: from === null ? null : {from, to}
  }
}

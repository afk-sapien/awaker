import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {articleLink, condition, conditionTone, espnArticles, normaliseName, playerIndex, readNews, resolveAthlete} from '../dist/news.js'
import {SOURCES, SOURCE_SWITCHES, sourceEnabled} from '../dist/sources.js'
import {playerNewsHTML, rosterNewsHTML, ago} from '../dist/ui/news.js'
import {S} from '../dist/ui/state.js'
import {contracts} from '../server/contracts.js'
import {validateSettings, defaults} from '../server/settings.js'

const NOW = Date.parse('2026-11-09T18:00:00Z'), HOUR = 3600000, DAY = 86400000
const player = (full_name, extra = {}) => ({full_name, position: 'WR', fantasy_positions: ['WR'], team: 'BUF', active: true, ...extra})
// Shaped like the live directory: espn_id on a minority, conditions on fewer still, and two players
// who share a name among the thousands who do not.
const players = {
 '1': player('A.J. Brown', {espn_id: '3121023', team: 'PHI'}),
 '2': player('Puka Nacua', {espn_id: null, team: 'LAR', injury_status: 'Questionable', injury_body_part: 'Knee',
  injury_notes: 'Limited Friday', news_updated: NOW - DAY}),
 '3': player('James Cook III', {position: 'RB', fantasy_positions: ['RB']}),
 '4': player('Twin Brother', {team: 'NYJ'}),
 '5': player('Twin Brother', {team: 'MIA'}),
 '6': player('Retired Guy', {team: null, active: false, injury_status: 'IR'}),
 '7': player('Squad Guy', {team: 'KC', status: 'Practice Squad'}),
 '8': player('Linebacker Guy', {position: 'LB', fantasy_positions: ['LB'], team: 'SF'})
}
const athlete = (id, description) => ({type: 'athlete', athlete: {id: id == null ? undefined : id, description}})
const article = (id, headline, published, categories = [], extra = {}) => ({
 id, type: 'Story', headline, description: 'The article body ESPN sends, which this app must never keep.',
 published: new Date(published).toISOString(), lastModified: new Date(published).toISOString(),
 links: {web: {href: `https://www.espn.com/nfl/story/_/id/${id}/x`}}, categories, ...extra
})
const feed = (...articles) => ({articles})

test('one normalised name covers the spellings the two providers use',() => {
 assert.equal(normaliseName('A.J. Brown'), normaliseName('AJ Brown'))
 assert.equal(normaliseName('James Cook III'), normaliseName('james cook'))
 assert.equal(normaliseName('Amon-Ra St. Brown'), 'amon ra st brown', 'a hyphen reads as a space on both sides, so it does not matter which side writes one')
 assert.equal(normaliseName('José  Álvarez'), 'jose alvarez')
 assert.equal(normaliseName('Marvin Harrison Jr.'), 'marvin harrison')
 // Two different men do not collide just because the suffix is dropped from one of them.
 assert.notEqual(normaliseName('Odell Beckham'), normaliseName('Odell Beckham Sr'.replace('Sr', 'Senior')))
 for (const nothing of [null, undefined, '', '  ', 42, {}]) assert.equal(typeof normaliseName(nothing), 'string')
})

test('a headline link is an ESPN page over https, or it is not a link',() => {
 assert.equal(articleLink('http://www.espn.com/nfl/story/1'), 'https://www.espn.com/nfl/story/1',
  'one of the fifty measured came back over http, so the scheme is decided here')
 assert.equal(articleLink('https://espn.com/x'), 'https://espn.com/x')
 for (const bad of ['https://notespn.com/x', 'https://espn.com.evil.test/x', 'javascript:alert(1)',
  'data:text/html,x', '//www.espn.com/x', 'https://user:pass@www.espn.com/x', '', null, undefined, 42, {}]) {
  assert.equal(articleLink(bad), null, JSON.stringify(bad) + ' is not a link out')
 }
})

test('the join is the ESPN id first and then a name that can only be one player',() => {
 const index = playerIndex(players)
 assert.equal(playerIndex(players), index, 'the index is kept with the directory it was built from')
 assert.deepEqual(resolveAthlete(index, {espnId: '3121023', name: 'Wrong Name'}), {id: '1', match: 'id'},
  'the id wins, and it is never the wrong man')
 assert.deepEqual(resolveAthlete(index, {espnId: null, name: 'Puka Nacua'}), {id: '2', match: 'name'},
  'Sleeper leaves espn_id null for most current players, so the name has to work')
 assert.deepEqual(resolveAthlete(index, {espnId: null, name: 'james cook'}), {id: '3', match: 'name'})
 assert.equal(resolveAthlete(index, {name: 'Twin Brother'}), null, 'a name two players hold identifies neither')
 assert.equal(resolveAthlete(index, {name: 'Retired Guy'}), null, 'a player on no team cannot be in anyone’s lineup')
 assert.equal(resolveAthlete(index, {espnId: '999', name: 'Nobody At All'}), null)
 assert.deepEqual(resolveAthlete(index, {name: 'Linebacker Guy'}), {id: '8', match: 'name'},
  'a defensive player in an IDP league is still a player this app holds')
})

test('a condition is reported only where the record says something, in the tones the app already uses',() => {
 assert.equal(condition(players['1']), null, 'no designation is the ordinary case')
 assert.equal(condition(null), null)
 const state = condition(players['2'])
 assert.deepEqual([state.status, state.bodyPart, state.notes, state.tone, state.updatedAt],
  ['Questionable', 'Knee', 'Limited Friday', 'questionable', NOW - DAY])
 assert.equal(state.practice, null, 'Sleeper sends no practice fields today: all three were empty across 3317 players')
 assert.equal(condition(players['7']).roster, 'Practice Squad', 'where he is on the roster is a condition too')
 assert.deepEqual(['Out', 'IR', 'PUP', 'Doubtful', 'Questionable', 'NA', ''].map(conditionTone),
  ['out', 'out', 'out', 'doubtful', 'questionable', 'other', null])
})

test('the read joins headlines to a roster, and never keeps an article body',() => {
 const payload = feed(
  article(1001, 'Brown returns to practice', NOW - 2 * HOUR, [athlete(3121023, 'A.J. Brown')]),
  article(1002, 'Nacua expected to play', NOW - HOUR, [athlete(null, 'Puka Nacua')]),
  article(1003, 'Linebacker signs extension', NOW - 3 * HOUR, [athlete(55555, 'Nobody At All')]),
  article(1004, 'Around the league', NOW - 4 * HOUR, [{type: 'league'}]),
  article(1005, 'No link here', NOW - HOUR, [athlete(3121023, 'A.J. Brown')], {links: {}})
 )
 const read = readNews({players, feed: payload, ids: ['1', '2', '7'], now: NOW, fetchedAt: NOW})
 assert.deepEqual(read.counts, {articles: 2, conditions: 2, players: 3, unresolvedTags: 1})
 assert.deepEqual(read.window, {from: NOW - 4 * HOUR, to: NOW - HOUR},
  'the window is how far back the feed itself reaches, including the stories that name nobody')
 assert.equal(read.generatedAt, NOW)

 const serialised = JSON.stringify(read)
 assert.doesNotMatch(serialised, /article body/, 'no article text is stored, shown or returned')
 assert.ok(read.items.every(item => !('description' in item)))

 // Conditions first, then the newest headline, so the list opens on what decides a lineup.
 assert.deepEqual(read.items.map(item => item.id), ['condition:2', 'condition:7', 'espn:1002', 'espn:1001'])
 const [nacua, brown] = [read.items.find(i => i.id === 'espn:1002'), read.items.find(i => i.id === 'espn:1001')]
 assert.deepEqual([nacua.match, nacua.matchedBy], ['name', {'2': 'name'}], 'a name match says so on the item itself')
 assert.deepEqual([brown.match, brown.matchedBy], ['id', {'1': 'id'}])
 assert.equal(brown.link, 'https://www.espn.com/nfl/story/_/id/1001/x')
 assert.equal(brown.source, SOURCES.espnNews.name)

 assert.equal(read.players['2'].mayHaveMoved, true, 'a headline newer than the record is the only warning there is')
 assert.equal(read.players['7'].mayHaveMoved, false, 'nothing has been written about him, so nothing has moved')
 assert.deepEqual(read.players['1'].items, ['espn:1001'])
 assert.deepEqual(read.players['2'].items, ['condition:2', 'espn:1002'])
 assert.equal(read.players['1'].condition, null)
 assert.deepEqual(read.sources.map(s => [s.key, s.enabled, s.available]), [['sleeper', true, true], ['espnNews', true, true]])
})

test('with ESPN switched off Sleeper answers alone, and every count says so',() => {
 const payload = feed(article(1001, 'Brown returns to practice', NOW - HOUR, [athlete(3121023, 'A.J. Brown')]))
 const off = readNews({players, feed: payload, ids: ['1', '2'], now: NOW, sources: {espnNews: false}})
 assert.deepEqual(off.counts, {articles: 0, conditions: 1, players: 1, unresolvedTags: 0})
 assert.equal(off.window, null)
 assert.deepEqual(off.sources.map(s => [s.key, s.enabled]), [['sleeper', true], ['espnNews', false]])
 assert.equal(off.items[0].source, SOURCES.sleeper.name, 'the base source works with every other one off')
 // And the same with no feed in hand at all, which is what a failed fetch leaves behind.
 assert.deepEqual(readNews({players, feed: null, ids: ['1', '2'], now: NOW}).counts,
  {articles: 0, conditions: 1, players: 1, unresolvedTags: 0})
})

test('the cap falls on the headlines and never on the conditions',() => {
 const many = feed(...Array.from({length: 30}, (_, i) =>
  article(2000 + i, `Story ${i}`, NOW - i * 60000, [athlete(3121023, 'A.J. Brown')])))
 const read = readNews({players, feed: many, ids: ['1', '2', '7'], now: NOW, limit: 3})
 assert.deepEqual(read.counts, {articles: 3, conditions: 2, players: 3, unresolvedTags: 0})
 assert.deepEqual(read.items.slice(2).map(i => i.headline), ['Story 0', 'Story 1', 'Story 2'], 'newest first')
 // A player's list may only point at items that came back, or it points at nothing a reader can open.
 const ids = new Set(read.items.map(item => item.id))
 for (const entry of Object.values(read.players)) for (const id of entry.items) assert.ok(ids.has(id), id + ' was returned')
 assert.deepEqual(read.players['1'].items, ['espn:2000', 'espn:2001', 'espn:2002'])
})

test('a league-wide read reports every player a headline resolves to',() => {
 const payload = feed(
  article(1001, 'Two in one story', NOW - HOUR, [athlete(3121023, 'A.J. Brown'), athlete(null, 'James Cook III'), athlete(null, 'Twin Brother')]))
 const read = readNews({players, feed: payload, ids: null, now: NOW})
 assert.deepEqual(read.items[0].players.sort(), ['1', '3'])
 assert.equal(read.items[0].match, 'name', 'one name match in the list makes the whole item a name match')
 assert.deepEqual(read.items[0].matchedBy, {'1': 'id', '3': 'name'})
 assert.equal(read.counts.unresolvedTags, 1, 'the shared name resolved to nobody')
 assert.equal(read.counts.conditions, 0, 'a league-wide read is about the news, not about every roster')
})

test('off wins between a static host and a service, and the base source cannot be switched off',() => {
 assert.deepEqual(SOURCE_SWITCHES, ['espnNews', 'espnScoreboard'], 'Sleeper is the base and has no switch')
 assert.equal(sourceEnabled('sleeper', {sleeper: false}), true)
 assert.equal(sourceEnabled('espnNews'), true, 'on by default for a self-hosted app')
 assert.equal(sourceEnabled('espnNews', {}, {espnNews: true}), true)
 assert.equal(sourceEnabled('espnNews', {espnNews: false}, {espnNews: true}), false, 'the host says no and that is the end of it')
 assert.equal(sourceEnabled('espnNews', {}, {espnNews: false}), false)
 assert.equal(sourceEnabled('nothing-like-this'), true)
})

test('the service exposes the read as one contract, and the switch is a setting',() => {
 const news = contracts.find(c => c.name === 'get_news')
 assert.ok(news, 'an agent reads news through the same module the page does')
 assert.deepEqual([news.path, news.method, news.call], ['/news', 'POST', 'news'])
 assert.match(news.description, /Headlines only, never article text/, 'the caller is told what it will not get')
 assert.match(news.description, /untrusted data/, 'and that a provider wrote the strings it is reading')
 assert.deepEqual(defaults.sources, {espnNews: true, espnScoreboard: true}, 'on by default for the owner of a self-hosted app')
 assert.deepEqual(validateSettings({sources: {espnNews: false}}).sources, {espnNews: false, espnScoreboard: true})
 assert.deepEqual(validateSettings({}).sources, {espnNews: true, espnScoreboard: true})
 for (const sources of [{sleeper: false}, {espnNews: 'no'}, {unknown: true}, [], 'off', 7]) {
  assert.throws(() => validateSettings({sources}), /Unknown data source setting/, JSON.stringify(sources))
 }
})

test('what the page prints is escaped, and a stale condition is flagged to the reader',() => {
 const hostile = '<img src=x onerror=alert(1)>'
 const payload = feed(
  article(1002, `Nacua ${hostile} expected to play`, NOW - HOUR, [athlete(null, 'Puka Nacua')]),
  article(1001, 'Brown returns', NOW - 2 * HOUR, [athlete(3121023, 'A.J. Brown')]))
 S.data = {players, leagues: [], nfl: {season: '2026', week: 10}, week: 10, projections: {}, games: {}, trends: [], demo: false}
 S.site = {name: 'Awaker', links: [], sources: {}}
 S.serviceSettings = null
 S.news = {state: 'ready', feed: payload, at: NOW - 60000}
 try {
  const profile = playerNewsHTML('2')
  assert.match(profile, /&lt;img src=x onerror=alert\(1\)&gt;/, 'a provider headline is text, never markup')
  assert.doesNotMatch(profile, /<img src=x/)
  assert.match(profile, /injury injury-questionable/)
  assert.match(profile, /Limited Friday/)
  assert.match(profile, /matched by name/, 'the reader is told when the join was by name')
  assert.match(profile, /may have moved/, 'a headline newer than the record says so where it is read')
  assert.match(profile, /href="https:\/\/www\.espn\.com\/nfl\/story\/_\/id\/1002\/x"/)
  assert.match(profile, /rel="noopener noreferrer"/)
  assert.match(playerNewsHTML('3'), /No designation on file/, 'nothing to say is said plainly')

  const strip = rosterNewsHTML(['1', '2', '7'])
  assert.match(strip, /<details class="news-strip">/)
  assert.match(strip, /1 player with a designation · 2 headlines/)
  assert.match(strip, /data-player="2"/, 'a name in the strip opens that player')
  assert.match(strip, /Headlines from ESPN/)

  S.site = {...S.site, sources: {espnNews: false}}
  const switched = rosterNewsHTML(['1', '2', '7'])
  assert.doesNotMatch(switched, /espn\.com/, 'a host that switched the source off makes no request and shows no headline')
  assert.match(switched, /switched off for this site/)
  assert.match(switched, /injury injury-questionable/, 'and the condition is still there')

  assert.deepEqual([ago(NOW, NOW), ago(NOW - 12 * 60000, NOW), ago(NOW - 5 * HOUR, NOW), ago(NOW - 2 * DAY, NOW)],
   ['just now', '12m ago', '5h ago', '2d ago'])
  assert.equal(ago(null), '')
 } finally {
  S.data = undefined
  S.news = null
 }
})

test('the news strip cannot push the watchroom footnote off a phone',() => {
 // The strip holds up to twenty rows. Left to grow it would stand between the player cards and the
 // footnote on a 390px screen, so it scrolls inside a fixed height, and its summary is a row a thumb
 // can hit where the pointer is a thumb.
 const css = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8')
 const rule = css.match(/\.news-strip>div\{[^}]*\}/)?.[0]
 assert.ok(rule, 'the strip body is the element to bound')
 assert.match(rule, /max-height:\d+px/)
 assert.match(rule, /overflow:auto/)
 assert.match(css, /@media\(pointer:coarse\)\{\.news-strip summary\{[^}]*min-height:34px/)
 const profile = readFileSync(new URL('../dist/player-details.css', import.meta.url), 'utf8')
 assert.match(profile, /\.player-news \.news-list\{[^}]*overflow:auto/, 'and the profile section scrolls rather than pushing the game log away')
})

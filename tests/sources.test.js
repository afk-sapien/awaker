import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../dist/api.js'
import {SOURCES, SOURCE_SWITCHES, NEWS_SOURCES, sourceEnabled} from '../dist/sources.js'
import {siteConfig} from '../dist/site.js'
import {defenseOutlook} from '../dist/defenses.js'
import {createProvider} from '../server/provider.js'

// One registry, read by the host file, the service settings and the content security policy, so a
// source that is not in it cannot be switched anywhere and a source that is in it is switchable
// everywhere. kind is what keeps the news read reporting news sources only.
test('every source in the registry is a switch the host and the owner both have',() => {
 assert.deepEqual(Object.keys(SOURCES), ['sleeper', 'espnNews', 'espnScoreboard'])
 assert.deepEqual(SOURCE_SWITCHES, ['espnNews', 'espnScoreboard'], 'Sleeper is the base and has no switch')
 assert.deepEqual(NEWS_SOURCES, ['sleeper', 'espnNews'], 'game status is not a news source')
 assert.equal(SOURCES.espnScoreboard.kind, 'games')
 assert.equal(sourceEnabled('espnScoreboard'), true, 'on by default for a self-hosted app')
 assert.equal(sourceEnabled('espnScoreboard', {espnScoreboard: false}, {espnScoreboard: true}), false, 'off wins')
 assert.deepEqual(siteConfig({sources: {espnScoreboard: false}}).sources, {espnScoreboard: false})
 assert.deepEqual(siteConfig({sources: {espnScoreboard: 'no'}}).sources, {}, 'only an exact false counts')
})

// The gate is in api.js, so none of the five callers can reach ESPN by forgetting to ask.
test('with game status off nothing asks ESPN for a scoreboard',async () => {
 const original = globalThis.fetch
 let calls = 0
 globalThis.fetch = async () => { calls++; return Response.json({events: []}) }
 try {
  api.allowGameStatus(false)
  assert.equal(api.gameStatusAllowed(), false)
  assert.deepEqual(await api.scoreboard(2099, 4), {}, 'no games, which readers already treat as unknown')
  assert.deepEqual(await api.scoreboard(2099, 5, {force: true}), {}, 'a forced refresh is still a refusal')
  assert.equal(calls, 0)
 } finally { api.allowGameStatus(true); globalThis.fetch = original }
})

// Sleeper names each player's team and that week's opponent, which is enough for who plays whom and
// who is on bye, and is not game status: no kickoff, no quarter, no clock, no score, no home side.
test('the pairings for a week are read off Sleeper projections, byes included',() => {
 const rows = {
  a: {team: 'BUF', opponent: 'NYJ', stats: {}},
  b: {team: 'NYJ', opponent: 'BUF', stats: {}},
  c: {team: 'WSH', opponent: 'JAC', stats: {}},
  d: {team: 'CHI', stats: {}},
  e: {opponent: 'BUF', stats: {}},
  f: null
 }
 const schedule = api.weekSchedule(rows)
 assert.deepEqual(Object.keys(schedule).sort(), ['BUF', 'NYJ', 'WAS'], 'a team with no opponent is on bye')
 assert.deepEqual(schedule.WAS, {opponent: 'JAX', source: 'sleeper'}, 'both ends of the pairing use the app spelling')
 assert.equal(schedule.BUF.home, undefined, 'Sleeper never says which side is at home')
 assert.equal(schedule.BUF.start, undefined, 'and never says when the game starts')
 assert.deepEqual(api.weekSchedule(null), {})
 assert.deepEqual(api.weekSchedule({}), {})
})

// The planner's byes come from the schedule, so a derived one has to carry them, or every defense on
// bye would be projected as though it played.
test('a derived schedule is enough for the defense planner to find a bye',() => {
 const players = {BUF: {position: 'DEF', team: 'BUF'}, CHI: {position: 'DEF', team: 'CHI'}}
 const projections = {4: {BUF: {stats: {pts_allow_0: 1}, team: 'BUF', opponent: 'NYJ'}, CHI: {stats: {pts_allow_0: 1}, team: 'CHI'}}}
 const outlook = defenseOutlook({players, projections, schedules: {4: api.weekSchedule(projections[4])}, weeks: [4], scoring: {pts_allow_0: 5}})
 assert.equal(outlook[4].rows.CHI.bye, true, 'no opponent in the feed is a bye')
 assert.equal(outlook[4].rows.BUF.bye, false)
})

// A week of trade and waiver advice needs the pairings and nothing else from the schedule, so with
// game status off it carries on instead of reporting the whole week unavailable.
test('future weeks still load for trades and waivers with game status off',async () => {
 const original = globalThis.fetch
 globalThis.fetch = async url => {
  assert.ok(!url.includes('espn.com'), url)
  return Response.json([{player_id: 'a', stats: {rec: 4}, team: 'BUF', opponent: 'NYJ'}])
 }
 try {
  api.allowGameStatus(false)
  const outlook = await api.tradeOutlook(2098, [9], () => {}, true)
  assert.deepEqual(outlook.errors, [])
  assert.deepEqual(outlook.data[9].games, {BUF: {opponent: 'NYJ', source: 'sleeper'}})
  assert.equal(outlook.data[9].projections.a.stats.rec, 4)
 } finally { api.allowGameStatus(true); globalThis.fetch = original }
})

// The service has no view to wait for, so it is the one place that fetches every week on a refresh.
// With the switch off it derives each of them and leaves games empty, because games is what the rest
// of the app reads to ask whether a game has started and nothing here knows that.
test('the service derives every week it would have fetched, and claims no game status',async () => {
 const original = globalThis.fetch
 const store = new Map()
 const backing = {get: key => store.get(key)?.value, set: (key, value) => store.set(key, {value, at: Date.now()}), at: key => store.get(key)?.at ?? null}
 const roster = n => ({roster_id: n, owner_id: `u${n}`, players: [n === 1 ? 'a' : 'b'], starters: [n === 1 ? 'a' : 'b'], reserve: [], taxi: []})
 globalThis.fetch = async url => {
  assert.ok(!url.includes('espn.com'), url)
  if (url.includes('/leagues/nfl/')) return Response.json([{league_id: 'L1', name: 'Test League', status: 'in_season', season: '2098', sport: 'nfl', total_rosters: 2, scoring_settings: {rec: 1}, roster_positions: ['WR']}])
  if (url.endsWith('/rosters')) return Response.json([roster(1), roster(2)])
  if (url.endsWith('/users')) return Response.json([{user_id: 'u1', display_name: 'Owner'}, {user_id: 'u2', display_name: 'Rival'}])
  if (url.includes('/matchups/')) return Response.json([{roster_id: 1, matchup_id: 1, points: 0, starters: ['a']}, {roster_id: 2, matchup_id: 1, points: 0, starters: ['b']}])
  if (url.includes('/user/')) return Response.json({user_id: 'u1', username: 'owner', display_name: 'Owner'})
  if (url.includes('/state/nfl')) return Response.json({season: '2098', week: 9, season_type: 'regular'})
  if (url.includes('players/nfl/trending')) return Response.json([])
  if (url.includes('/projections/')) return Response.json([{player_id: 'a', stats: {rec: 4}, team: 'BUF', opponent: 'NYJ'}, {player_id: 'b', stats: {rec: 1}, team: 'CHI'}])
  return Response.json({a: {player_id: 'a', full_name: 'A Receiver', position: 'WR', team: 'BUF', active: true}, b: {player_id: 'b', full_name: 'B Receiver', position: 'WR', team: 'CHI', active: true}})
 }
 try {
  const data = await createProvider(backing)({username: 'owner', disabled: [], preferences: {}, sources: {espnScoreboard: false}})
  assert.deepEqual(data.games, {}, 'nothing here can say whether a game has started')
  assert.deepEqual(data.schedules[9], {BUF: {opponent: 'NYJ', source: 'sleeper'}}, 'CHI has no opponent, so CHI is on bye')
  assert.ok(Object.keys(data.schedules).length > 1, 'every week it fetched projections for has its pairings')
  assert.ok(!data.sources.some(s => s.name.startsWith('schedule/')), 'and no ESPN source is reported as fetched')
 } finally { globalThis.fetch = original }
})

// The demo invents a quarter and a clock of its own, which is game status by another route. A site
// that says it shows none would otherwise show a running clock on the front page it greets people with.
test('the demo loses its clock with game status switched off, and keeps who plays whom', async () => {
 const {demo, demoWithoutGameStatus} = await import('../dist/demo.js')
 const full = demo()
 assert.ok(Object.values(full.games).some(g => g.state === 'in'), 'the demo normally has a game in progress')
 const off = demoWithoutGameStatus(full)
 assert.deepEqual(off.games, {}, 'nothing left that could claim a quarter or a clock')
 assert.deepEqual(Object.keys(off.schedules), Object.keys(full.schedules), 'every week it had a pairing for keeps one')
 for (const teams of Object.values(off.schedules)) {
  for (const [team, pairing] of Object.entries(teams)) {
   assert.deepEqual(Object.keys(pairing).sort(), ['opponent', 'source'], `${team} says only who it plays`)
   assert.equal(pairing.source, 'sleeper')
   assert.equal(typeof pairing.opponent, 'string')
  }
 }
 assert.equal(off.players, full.players, 'and the rest of the demo is untouched')
 assert.equal(off.leagues, full.leagues)
})

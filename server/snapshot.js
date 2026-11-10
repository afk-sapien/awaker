// One league, in one document, for an agent that would otherwise make six calls and still not know
// which numbers are the owner's opinion rather than Sleeper's.
//
// Three rules shape it.
//
// 1. Every number an agent can act on travels as a triple: points, sleeperPoints, correctedBy. An
//    agent that writes a correction and then reads its own number back would otherwise agree with
//    itself forever. The original has to be in the same object as the adjusted figure, not in a
//    footnote, and the source has to say whose opinion moved it.
// 2. A null is not a zero and the document has to say which kind of null it is. A projection of
//    null with correctedBy set is the owner or an agent asserting the player will not play. A
//    projection of null with correctedBy null is Sleeper having nothing to say about him. Those lead
//    to opposite decisions, so they are distinguishable without a second call.
// 3. Freshness is per part. The player directory has a 24 hour cache, projections an hour, the news
//    window about sixteen hours, and the overrides fingerprint changes the instant anyone writes
//    one. An agent is told the age of each rather than one generatedAt it has to trust for all.
import {activeSlots, optimize, playableIds, projected, suspectStats} from '../dist/engine.js'
import {lockedLineup, usableValue} from '../dist/analysis.js'
import {matchupDetail, teamName} from '../dist/league.js'
import {NO_OVERRIDES, expired} from '../dist/overrides.js'

const round = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null
const age = (at, now) => Number.isFinite(at) && at > 0 ? Math.max(0, now - at) : null
// Sleeper sends the whole scoring table with every category it does not use set to zero, which is
// about a hundred keys of nothing. A zero cannot score a point, so only the live categories travel
// and the count of the rest says the table was not truncated by accident.
export function scoringTable(scoring) {
  const entries = Object.entries(scoring || {}).filter(([, value]) => Number.isFinite(value) && value !== 0)
  return {scores: Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : 1)), unusedCategories: Object.keys(scoring || {}).length - entries.length}
}

// A correction as an agent should read it: the whole record, plus whether this caller wrote it and
// whether it still applies this week. mine is what makes a write tool safe to offer later, because
// an agent can see which records are its own before it tries to change one.
export function describeOverride(record, {week, agent = null, name = null}) {
  return {
    player: record.player,
    playerName: name,
    points: record.points,
    status: record.status,
    bodyPart: record.bodyPart,
    rosterStatus: record.rosterStatus,
    note: record.note,
    reason: record.reason,
    from: record.from,
    until: record.until,
    source: record.source,
    at: record.at,
    mine: !!agent && record.source === `agent:${agent}`,
    active: !expired(record, {week})
  }
}

// Everything the document says about one player, including the triple. The patched directory is the
// one an override has already moved, so injuryStatus is what the app acts on and sleeperInjuryStatus
// is what Sleeper actually sent, carried only when a correction moved it.
export function playerRow(id, {data, league, lens, week, patched}) {
  const raw = data.players[id]
  if (!raw) return null
  const seen = patched[id] || raw
  const stats = data.projections[week]?.[id]?.stats
  const sleeperPoints = projected(stats, league.scoring_settings)
  const record = lens.find(id, week)
  const game = data.games[seen.team] || null
  const suspect = suspectStats(stats, league.scoring_settings)
  const sleeperStatus = raw.injury_status || null
  const status = seen.injury_status || null
  return {
    id,
    name: raw.full_name || id,
    position: raw.position || null,
    team: raw.team || null,
    injuryStatus: status,
    ...(status === sleeperStatus ? {} : {sleeperInjuryStatus: sleeperStatus}),
    bodyPart: seen.injury_body_part || null,
    rosterStatus: seen.status || null,
    newsUpdatedAt: Number.isFinite(Number(raw.news_updated)) ? Number(raw.news_updated) : null,
    game: game ? {opponent: game.opponent ?? null, home: !!game.home, state: game.state} : null,
    projection: {points: round(lens.project(sleeperPoints, id, week)), sleeperPoints: round(sleeperPoints), correctedBy: record ? record.source : null},
    ...(suspect.length ? {suspect} : {})
  }
}

// A lineup row keeps only what the matchup needs. Everything else about the player, the triple
// included, is in the player table, so a sixteen row lineup does not repeat a name and a team.
const line = row => ({slot: row.slot, label: row.label, id: row.id, points: row.points, projection: row.projection, state: row.state})

export function buildSnapshot({data, league, lens = NO_OVERRIDES, newsRead = null, newsFetchedAt = null, caller = {}, now = Date.now()}) {
  const week = data.week, l = league, agent = caller.agent || null
  const patched = lens.players(data.players, week) || data.players
  const mine = l.mine.roster_id
  const pair = (l.matchups || []).find(m => m.roster_id === mine)
  const opponentId = pair?.matchup_id == null ? null : (l.matchups.find(m => m.matchup_id === pair.matchup_id && m.roster_id !== mine)?.roster_id ?? null)
  const rosterIds = pair ? (opponentId == null ? [mine] : [mine, opponentId]) : []
  const detail = rosterIds.length ? matchupDetail({league: l, players: data.players, projections: data.projections[week] || {}, games: data.games, rosterIds, current: week === (data.nfl?.week ?? week), week, overrides: lens}) : null

  // The optimizer, run exactly as the dashboard and get_opportunities run it, so an agent reading the
  // snapshot and an owner reading the page are told to start the same players.
  const {ids: currentIds, locks} = lockedLineup(data, l)
  const value = id => usableValue(data, l, id, Object.values(locks))
  const slots = activeSlots(l)
  const best = optimize(playableIds(l.mine), slots, data.players, value, locks, currentIds)
  const currentTotal = currentIds.reduce((sum, id) => sum + (value(id) || 0), 0)

  const teams = (l.rosters || []).map(roster => {
    const named = teamName(l, roster.roster_id)
    const matchup = (l.matchups || []).find(m => m.roster_id === roster.roster_id) || null
    return {
      rosterId: roster.roster_id,
      team: named.team,
      manager: named.manager,
      mine: roster.roster_id === mine,
      record: {wins: roster.settings?.wins ?? null, losses: roster.settings?.losses ?? null, ties: roster.settings?.ties ?? null},
      matchupId: matchup?.matchup_id ?? null,
      starters: matchup?.starters || roster.starters || [],
      players: roster.players || [],
      reserve: roster.reserve || [],
      taxi: roster.taxi || []
    }
  })

  // Everyone the document mentions, once. A rostered player, anyone the news joined to, and anyone
  // carrying a correction, so an agent never has to look a name up in a second call.
  const wanted = new Set(teams.flatMap(t => [...t.players, ...t.starters, ...t.reserve, ...t.taxi]).filter(id => id && id !== '0'))
  for (const item of newsRead?.items || []) for (const id of item.players || []) wanted.add(String(id))
  for (const record of lens.scoped) wanted.add(record.player)
  const players = {}
  for (const id of wanted) {
    const row = playerRow(id, {data, league: l, lens, week, patched})
    if (row) players[id] = row
  }

  const activeOverrides = lens.scoped.map(record => describeOverride(record, {week, agent, name: players[record.player]?.name ?? data.players[record.player]?.full_name ?? null}))
  const newsWindow = newsRead?.window || null
  return {
    league: {
      id: l.league_id,
      name: l.name,
      season: data.nfl?.season ?? null,
      week,
      size: (l.rosters || []).length,
      rosterPositions: l.roster_positions || [],
      startingSlots: slots,
      scoring: scoringTable(l.scoring_settings)
    },
    you: {rosterId: mine, team: teamName(l, mine).team},
    teams,
    lineup: {
      slots,
      current: currentIds,
      currentTotal: round(currentTotal),
      recommended: best.ids,
      recommendedTotal: best.total,
      gain: Number.isFinite(best.total) ? round(best.total - currentTotal) : null,
      complete: best.complete,
      starters: detail ? detail.sides[0].starters.map(line) : [],
      bench: detail ? detail.sides[0].bench.map(line) : []
    },
    matchup: detail ? {
      matchupId: pair?.matchup_id ?? null,
      opponentRosterId: opponentId,
      sides: detail.sides.map((side, i) => ({
        rosterId: side.rosterId,
        team: teamName(l, side.rosterId).team,
        mine: side.rosterId === mine,
        points: side.points,
        projection: side.projection,
        heading: side.heading,
        benchPoints: side.benchPoints,
        // Your own starters are in lineup.starters already, so only the opponent's are repeated here.
        ...(i === 0 ? {} : {starters: side.starters.map(line)})
      }))
    } : null,
    players,
    news: newsRead ? {items: newsRead.items, players: newsRead.players, sources: newsRead.sources, counts: newsRead.counts, window: newsRead.window} : null,
    overrides: {
      fingerprint: lens.fingerprint,
      count: activeOverrides.filter(o => o.active).length,
      mine: activeOverrides.filter(o => o.mine).length,
      youAre: agent ? `agent:${agent}` : 'owner',
      records: activeOverrides
    },
    ages: {
      players: {at: data.playersAt ?? null, ageMs: age(data.playersAt, now)},
      projections: {at: data.updatedAt ?? null, ageMs: age(data.updatedAt, now)},
      news: {fetchedAt: newsFetchedAt, ageMs: age(newsFetchedAt, now), from: newsWindow?.from ?? null, to: newsWindow?.to ?? null}
    }
  }
}

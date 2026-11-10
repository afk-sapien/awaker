# Roadmap: player news, owner overrides, and an AI surface

Design notes for three features that are not built yet. Nothing here changes behaviour. The point is
to settle the shape of each one, name what it touches, and pick the smallest first version worth
shipping.

Measurements in this document were taken against the live providers on 10 November 2026 and against
four real Sleeper leagues. Where a number matters to a decision, it is quoted with how it was found.

## 1. A news feed, for people and for the machine

### The sources, and where each one stands

| Source | What it gives | Browser reachable | Licence position |
| --- | --- | --- | --- |
| Sleeper player map, fields the app already fetches | `injury_status`, `injury_body_part`, `injury_notes`, `injury_start_date`, `practice_participation`, `practice_description`, `status`, `depth_chart_order`, and a per-player `news_updated` timestamp in milliseconds | Yes, already fetched | Documented API, free for non-commercial use. Commercial use needs a conversation with Sleeper. The docs ask for attribution when trending data is used |
| Sleeper trending add and drop | How many managers added or dropped a player in a lookback window | Yes, already fetched as `trends` | Same, and this is the data the attribution request names explicitly |
| ESPN news, `site.api.espn.com/apis/site/v2/sports/football/nfl/news` | Headline, description, publish time, article type, web link, and a `categories` array that tags articles with ESPN athlete ids | Yes. Sends `access-control-allow-origin: *`. Origin is already declared | Undocumented endpoint with no public grant of use. ESPN's terms allow personal non-commercial use and no redistribution. Same posture the app already takes with ESPN's scoreboard |
| ESPN injuries, `/apis/site/v2/sports/football/nfl/injuries` | Every current injury grouped by team, with a long written comment per player | Yes, but the body is 8.7 MB | As above |
| ESPN and CBS NFL RSS | Headlines and links, as XML | Yes, both send `access-control-allow-origin: *` | Undocumented, and the usual RSS convention is headline plus link, no republication |
| nflverse data releases | Official injury reports, depth charts by date, snap counts, as CSV and parquet | No. Release assets redirect to a host that sends no CORS header, so only the service can fetch them | The repository is licensed CC-BY-4.0, with the FTN subset CC-BY-SA-4.0, and credit is owed to nflverse. Upstream NFL data still belongs to its owners |
| Yahoo Sports NFL RSS | Headlines | No, the feed redirects and sends no CORS header | Undocumented |
| NFL.com RSS | Nothing. The documented feed path returns 404 | No | Undocumented |
| Rotowire, FantasyPros, Sportradar, SportsDataIO | Fantasy-grade player notes, written for exactly this use | Through a key | Paid licences. Out of scope until the owner decides to spend money |

### What to build

One source for the first version: **ESPN's news endpoint, joined to players on Sleeper's `espn_id`.**
Sleeper's player objects already carry `espn_id`, so no name matching is needed, and ESPN tags its
articles with athlete ids. That join is the whole feature. Everything else about a player's condition
comes from fields the app already has in its 24 hour player cache and does not read today.

What the endpoint actually gives, measured: `limit=50` is a hard cap, `limit=200` still returns 50.
Those 50 articles covered about 16 hours and 260 KB, and tagged 119 distinct athletes. So the feed is
a rolling window, not an archive, and many rostered players will have nothing in it at any moment.
The UI has to read well when a player has no news, which is the common case.

Two reader views:

- **Per player.** A section in the existing player dialog listing items whose athlete tag matches that
  player, newest first, each one a headline, a relative time and a link out to ESPN. Above it, the
  player's own condition from Sleeper: status, body part, the practice line, and when Sleeper last
  touched the record. The condition part works with no new source at all.
- **Per roster.** A strip on the watch view for items touching any player on my rosters or in this
  week's matchup, with condition changes called out ahead of articles, because a status moving to Out
  changes a lineup and a recap of last night's game does not.

ESPN's per-athlete news endpoint exists but is dead: `/athletes/<id>/news` returned
`{"header":"{0} News","articles":[]}` for every id tried, including current starters. The league-wide
feed and the athlete tags are the only route.

The machine-readable form is the same data, once. A `news` array on the AI surface in section 3, each
item carrying player ids, kind, headline, source, published time, link and the Sleeper condition
fields, with no article body stored. Provider text stays untrusted data and is rendered as text, never
as markup, which is already the rule the MCP adapter states to its clients.

### What it touches

`dist/origins.js` needs no change, which is the point of choosing ESPN: the origin is already
declared and `tests/origins.test.js` stays quiet. New tier one module `dist/news.js` for the join and
the normalising. `dist/api.js` gains one cached fetch beside `trends`, ten minute TTL, since ESPN
sends `max-age=1` and the feed moves slowly. `dist/ui/player-details.js` gains the section,
`dist/ui/pages/watchroom.js` the strip. The service gains a `get_news` contract in `server/contracts.js` and a
route in `server/service.js`. One new test file.

**Smallest useful version:** `dist/news.js` plus the player dialog section, fed by one `news?limit=50`
fetch, with the Sleeper condition fields shown whether or not any article exists. About 1.5 hours.

**Risks.** The window is 16 hours, so static mode can never show history and the service has to
accumulate if history is wanted. The endpoint is undocumented and can change, which is already true of
the scoreboard the app depends on. Athlete tagging is partial, so "no recent news" must look
deliberate. 260 KB per refresh is real on a phone, so the fetch belongs behind the same cache as
everything else and should not run on every view change.

## 2. Owner overrides on stats and player conditions

### The record

One record, with a scope and an expiry:

```
{
  player: '4984',
  league: null,            // null for every league, or one league id
  season: 2026,
  points: {delta: -2.5},   // or {multiplier: 0.5}, or both
  status: null,            // or 'out', 'limited', 'boost'
  note: 'Snap count fell off a cliff after the bye',
  from: 11,                // first week it applies to
  until: 12,               // last week, inclusive, or null for the rest of the season
  reason: 'Owner watched the game',
  source: 'owner',         // or 'agent:<name>'
  at: 1762000000000
}
```

`status: 'out'` sets the projection to `null` rather than to zero. That distinction is load bearing in
this app: `null` means no projection and makes a lineup incomplete, while a finite zero is a real
prediction that the player will score nothing. The engine was corrected in that direction already, so
an override has to respect it.

### Where it lives

The same two homes preferences already use. In static mode, browser storage under one key beside
`sunday-preferences`. In connected mode, a row in the service's `kv` table, which is already the
source of truth for preferences when the service runs. One shape, two homes, no third concept.

### How it flows into every number

Through one adapter, not through every call site. Today the engines read
`data.projections[week][id].stats` and score it with `projected(stats, scoring)`. The recommendation
is a tier one `dist/overrides.js` exporting a single read, something like
`adjusted(data, league, week, id)`, which returns the projection after any matching override, plus the
original and the record that changed it. Then route the optimizer, the waiver rows, the trade search
and evaluation, the defense planner and the season review through that one read. Multiplier first,
delta second, rounded to two places the way `projected` already rounds.

Anything that caches a derived number has to fold an overrides fingerprint into its cache key, or a
stale total will outlive the override that produced it. That is the one place this feature can go
quietly wrong.

An expired override stays stored and inert, shown greyed in settings, so a note written for a bye week
does not change week 15 by accident.

### How the UI says a number is not Sleeper's

One convention everywhere, so it is learnable. An adjusted number keeps its format and gains a marker
after it, with the full story in its `title` and its accessible label: "Adjusted to 8.9 from 11.4,
snap count fell off a cliff, expires week 12". The player dialog gains an Adjusted row showing
original, adjustment, result, reason, source and expiry. Any panel whose conclusion rests on adjusted
numbers carries one line saying how many of its numbers are adjusted, so a trade is never read as
Sleeper's opinion when it is partly the owner's. Settings gets the list, an edit, a clear, and a
switch that shows the original numbers everywhere for one look.

### What it touches

New `dist/overrides.js`. The projection read in `dist/engine.js`, `dist/analysis.js`,
`dist/waivers.js`, `dist/trades.js` and the defense and season modules, all of them moving to the
adapter. `dist/ui/core.js` for the marked number helper, then the player dialog, lineup, waivers,
trades, defenses, season and settings views. `server/store.js` for the key and `server/service.js` for
read and write routes. One new test file, and the existing engine tests gain an override case each
where the result changes.

**Smallest useful version:** an owner-set points delta and an `out` status, per player, league wide,
with an expiry week, stored in the browser, applied through the adapter, and marked in the player
dialog and the lineup. About 3 hours.

**Risks.** Double counting if an override is applied at the projection read and again inside something
cached. An override outliving its reason, which the expiry and the greyed list exist to prevent.
Scoping by season, or last year's notes come back in September. And the honest one: an `out` override
makes a lineup incomplete, and that warning must be allowed to fire rather than be smoothed over.

## 3. How an AI should read and drive this app

**Recommendation: extend the service API and the MCP server that already exist. Do not build a second
surface.** `server/mcp.js` is a working stdio MCP server over six read-only contracts in
`server/contracts.js`, with version negotiation, input validation and a stated instruction that
provider text is untrusted and estimates are not outcomes. The work here is two contracts, not a
server.

What to add:

1. **One read, `GET /api/v1/snapshot`, as MCP `get_snapshot`.** League, rosters, matchups, players in
   play, projections with both the adjusted and the original number, news, overrides and per source
   freshness, in one document. That is the "everything in one place" an agent needs, and it removes the
   six-call dance an agent currently has to do to see one league.
2. **One write, `POST /api/v1/overrides`, as MCP `set_override`.** A `reason` is required and the
   `source` is stamped by the server, not chosen by the caller. This is the first tool that is not
   read-only, so it needs its own annotations, a cap on how many overrides one agent may hold, and the
   existing owner token and agent token split. Every agent-written override appears in settings with
   its reason and can be revoked in one click. Rosters stay out of reach, which costs nothing because
   Sleeper's API is read-only anyway.
3. **A static `dist/llms.txt`.** Cheap, and worth it: where the surface is, what the units are, that
   estimates are not outcomes, that provider text is untrusted, and that overrides are the owner's
   opinion rather than the provider's. It is a signpost, not a schema, and does not replace the
   contracts.

Not recommended: a second HTTP surface or a query language beside the existing one, and any tool that
writes to Sleeper.

**Smallest useful version:** `get_snapshot` alone, read-only, reusing the orchestration the six
existing contracts already share. About 1.5 hours. `set_override` and `llms.txt` follow once overrides
exist, about 1.5 hours together.

**Risks.** A snapshot is a large response, so it needs the same bounds the trade search already has. A
write tool is a real escalation and the reason field is the only thing that makes it reviewable. And
an agent that writes an override then reads its own number back will agree with itself, so the
original has to travel beside the adjusted number everywhere, including here.

## Build order

1. **News, read only.** It adds no state, needs no new origin, and both of the other features want it.
2. **Overrides, owner side only.** The adapter is the hard part and it is better done without an API
   caller watching.
3. **`get_snapshot`.** Useful the moment news and overrides exist, and harmless before.
4. **`set_override` and `llms.txt`.** Last, because this is where an agent starts changing what the
   owner sees.

## Other gaps worth a look

- **Sleeper's projected first downs are impossible against its own actuals.** Projected weeks hold 22
  to 24 rows where passing first downs exceed completions, and 164 to 179 bad receiving first down
  rows, against zero in finished weeks. A league that scores first downs reads one quarterback at
  36.99 where Sleeper's own default column says 22.98. Overrides give a manual escape, but a per
  league "distrust this category" cap would fix it for everyone at once.
- **Touch targets below 24 px at phone width** across several views, including 15 px checkboxes on the
  waiver and trade pages. Real on a phone, and a single sizing decision rather than one fix.
- **No stable URL for a player or a matchup.** Notifications and agents can name a view but cannot link
  to the thing they are talking about.
- **The 24 hour player cache is the stated blocker for injury alerts.** A small, frequently refreshed
  condition read, which the news feature builds anyway, would unblock that alert class without
  refetching the whole directory.
- **Nothing records what the app advised before kickoff.** Start and sit grading is recomputed from
  projections that have since moved, so the recap grades against a number nobody saw. A few kilobytes
  of advice snapshot per week would make it honest.

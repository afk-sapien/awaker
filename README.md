# Sunday — Fantasy Football HQ

A dependency-free, self-hostable prototype for following multiple Sleeper NFL leagues.

## Run locally

Python 3 is the only server requirement:

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. The app starts with clearly labeled sample leagues. Choose **Connect Sleeper** and enter a public Sleeper username to load all current-season leagues. Use **My leagues** to choose which ones to include. No Sleeper password or API key is needed.

## Self-host

Serve the `dist/` directory using any static web server. No build, paid API key, backend, or database is required. Docker is optional:

```sh
docker build -t sunday .
docker run --rm -p 8080:80 sunday
```

The browser needs internet access to api.sleeper.app and site.api.espn.com. Google Fonts are optional; system fonts are the fallback. If hosted publicly, protect the site through your hosting provider if desired. Sleeper's public data is fetched directly by each browser; no authenticated Sleeper actions occur.

## Implemented

- Multi-league discovery and browser-local league selection.
- Deduplicated player watchroom, jersey numbers, NFL game status, per-league actual scores, opponent exposure, bench toggle, search, pins, and focus mode.
- 45-second refresh while the tab is visible, explicit refresh, week selection, failure notices and preserved last-known data.
- League-specific waiver availability, global adds, projected marginal lineup gains and drop candidates. Independent saved pickup/drop position exclusions include all/no-kicker/flex/none presets and an upgrades-only filter; starter and never-drop protections remain enforced.
- Exact position/flex assignment via dynamic programming, started lineup locks, unavailable projections and injury exclusions.
- Remaining-season manual trades and one-for-one suggestions, week-by-week optimized lineups, bye weeks, adjustable minimum gains for both managers, replacement-value balance limits, and a rival-gain penalty. Multi-player packages must fit both rosters; no invented pickups or automatic drops.
- Five-week defense projections and two-defense rotation comparisons. Weekly heatmaps compare each matchup with the league-scored median of all projected NFL defenses; byes are excluded and missing estimates stay neutral.
- Read-only, feature-detected WebMCP watchroom tool.

## Data and limitations

- Official Sleeper API: https://docs.sleeper.com/ (read-only league, roster, player, matchup and trending endpoints). Trending data attributed to Sleeper. API free for noncommercial use; commercial use requires discussing licensing with Sleeper.
- Experimental projections: `https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular`. This endpoint is not part of the documented supported API. It may fail or change. Projections are mapped to league scoring using available stat fields; unmodeled scoring keys are explicitly listed. Nonlinear bonuses and absent projected stats can make estimates incomplete.
- ESPN public scoreboard supplies NFL game state, opponents, broadcast labels and game scores. It is an unofficial dependency with no availability guarantee. Game-live status is not on-field player tracking.
- Actual fantasy scores come from Sleeper matchup `players_points`; different leagues retain separate values. Missing data is displayed as unavailable, never silently shown as zero. Scores can lag broadcasts.
- Advice is deterministic and based on expected points. No calibrated win odds, injury probability model, actual transaction submission, FAAB bid estimation, dynasty/pick valuation, or external notifications. Trades take effect the following week and default to ending in Week 17 (Week 18 optional). Each future week uses its own projection feed and schedule; missing weeks pause the analysis instead of extrapolating next week. Replacement-value balance is a projection-based heuristic, not a market price or acceptance probability. Waiver suggestions prioritize current starting-lineup gains and may undervalue depth.
- All current-season leagues are discoverable. The prototype supports team defenses and ordinary flex/superflex lineups; optimizers are capped at 15 unlocked starting slots. Nonstandard position/scoring rules need further validation.
- A second defense's bench cost is called out but not subtracted from rotation gain. Future missing projections are shown as unavailable; rotation recommendations need all included weeks.
- Username, league exclusions, pins, filters, roster protections and trade settings are stored locally. API data is cached in memory and IndexedDB across page reloads: scores/game status for 30 seconds, rosters for one minute, trends for 15 minutes, projections/league users/future schedules for one hour, and the player directory for 24 hours. Concurrent requests for the same resource share one fetch. Storage failures fall back to memory; failed requests are retried, not silently replaced with expired cached data. No secrets are stored.
- Visible tabs still poll every 45 seconds. **Refresh** bypasses caches for current rosters, league users, scores, trends and the five-week projections and schedules; **Refresh outlook** bypasses future projection/schedule caches. Start/sit, waiver analysis and season models reuse bounded in-memory results across navigation and leagues. Roster/scoring/projection/filter changes invalidate the relevant results; score-only updates do not rebuild season models. First-time analyses still need data and computation.

## Planned integrations

[Agent access, digests, and important-event alerts](docs/agent-and-notification-plan.md) describes an optional API/MCP service, daily or weekly reports, and ntfy notifications. This is a proposal; background scheduling and external notification delivery are not implemented.

## Tests

Node 22+ is sufficient; no install required:

```sh
npm test
```

Checks cover unique legal flex assignment, started player locks, negative points, missing projections, league scoring differences, multi-league ownership/opponent deduplication, reserve/taxi availability, protected waiver drops, score changes, weekly and season trade valuation, bye/missing data, value imbalance and negligible opponent gains. The season assignment solver is checked against the existing exact optimizer across 80 deterministic flex/superflex scenarios. Cache tests cover concurrent request deduplication, persistence, expiry, force refresh, failures, bounded memory, league/week isolation, and roster/scoring invalidation.

## Files

- `dist/app.js`: interface and orchestration
- `dist/api.js`: provider adapters and persistent resource caching
- `dist/cache.js`: shared request cache and bounded computation memoization
- `dist/engine.js`: pure lineup, scoring, trade and aggregation functions
- `dist/defenses.js`: five-week windows, median baselines and matchup color bands
- `dist/trades.js`: season lineup assignment, remaining-season impact and realism checks
- `dist/demo.js`: explicitly illustrative sample data
- `dist/styles.css`: responsive presentation

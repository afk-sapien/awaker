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

- **Theme** in the top bar lets you choose any of the 32 NFL teams or reset to Sunday original. Colors apply across navigation, buttons, controls, and the page background, and save locally in this browser. Score and availability colors retain their meanings.

- Multi-league discovery and browser-local league selection.
- Deduplicated player watchroom, jersey numbers, NFL game status, per-league actual scores, opponent exposure, bench toggle, search, pins, and focus mode.
- 45-second refresh while the tab is visible, explicit refresh, week selection, failure notices and preserved last-known data.
- League-specific waiver availability, global adds, projected marginal lineup gains and drop candidates. This-week, next-week and rest-of-season planning compare lineup impact. Future views optimize each week separately with bye schedules, keeping the same pickup and drop throughout the window; missing forecasts pause the affected advice. Season totals include a weekly impact breakdown and default to Weeks following the selected week through Week 17 (Week 18 optional). Independent saved pickup/drop position exclusions, protections and an upgrades-only filter live in a collapsed settings panel.
- Exact position/flex assignment via dynamic programming, started lineup locks, unavailable projections and injury exclusions.
- Separate Auto trades and Trade builder pages for remaining-season one-for-one suggestions and manual packages, week-by-week optimized lineups, bye weeks, adjustable minimum gains for both managers, replacement-value balance limits, and a rival-gain penalty. Multi-player packages must fit both rosters; no invented pickups or automatic drops.
- Five-week defense projections and two-defense rotation comparisons. Weekly heatmaps compare each matchup with the league-scored median of all projected NFL defenses; byes are excluded and missing estimates stay neutral. Team names show league-specific ownership (green available, red rostered elsewhere, blue yours); other managers’ defenses are comparison-only and excluded from rotations.
- Read-only, feature-detected WebMCP watchroom tool.
- Optional authenticated agent API/MCP service, durable report scheduling, ntfy trade alerts, and owner settings.

## Data and limitations

- Official Sleeper API: https://docs.sleeper.com/ (read-only league, roster, player, matchup and trending endpoints). Trending data attributed to Sleeper. API free for noncommercial use; commercial use requires discussing licensing with Sleeper.
- Experimental projections: `https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular`. This endpoint is not part of the documented supported API. It may fail or change. Projections are mapped to league scoring using available stat fields; unmodeled scoring keys are explicitly listed. Nonlinear bonuses and absent projected stats can make estimates incomplete.
- ESPN public scoreboard supplies NFL game state, opponents, broadcast labels and game scores. It is an unofficial dependency with no availability guarantee. Game-live status is not on-field player tracking.
- Actual fantasy scores come from Sleeper matchup `players_points`; different leagues retain separate values. Missing data is displayed as unavailable, never silently shown as zero. Scores can lag broadcasts.
- Advice is deterministic and based on expected points. No calibrated win odds, injury probability model, actual transaction submission, FAAB bid estimation, dynasty/pick valuation, or live injury alerts. Optional summaries and trade alerts use the background service described below. Trades take effect the following week and default to ending in Week 17 (Week 18 optional). Each future week uses its own projection feed and schedule; missing weeks pause the analysis instead of extrapolating next week. Replacement-value balance is a projection-based heuristic, not a market price or acceptance probability. Waiver suggestions prioritize starting-lineup gains over the selected window and may undervalue depth. They do not estimate future availability, waiver priority or transaction lock rules.
- All current-season leagues are discoverable. The prototype supports team defenses and ordinary flex/superflex lineups; optimizers are capped at 15 unlocked starting slots. Nonstandard position/scoring rules need further validation.
- A second defense's bench cost is called out but not subtracted from rotation gain. Future missing projections are shown as unavailable; rotation recommendations need all included weeks.
- In static mode, username, league exclusions, pins, filters, roster protections and trade settings are stored locally. In service mode, account and analysis settings are also persisted by the service. API data is cached in memory and IndexedDB across page reloads: scores/game status for 30 seconds, rosters for one minute, trends for 15 minutes, projections/league users/future schedules for one hour, and the player directory for 24 hours. Concurrent requests for the same resource share one fetch. Storage failures fall back to memory; failed requests are retried, not silently replaced with expired cached data. No secrets are stored.
- Visible tabs still poll every 45 seconds. **Refresh** bypasses caches for current rosters, league users, scores, trends and the five-week projections and schedules; **Refresh outlook** bypasses future projection/schedule caches. Start/sit, waiver analysis and season models reuse bounded in-memory results across navigation and leagues. Roster/scoring/projection/filter changes invalidate the relevant results; score-only updates do not rebuild season models. First-time analyses still need data and computation.

## Agent access and notifications

The optional Node service provides a read-only API and stdio MCP adapter, persistent daily/weekly summaries, and ntfy alerts for strong new trade opportunities. Open **My leagues → Agents & updates** to configure it. All schedules and alerts start disabled. See [setup and operation](docs/integrations.md) for tokens, account import, Docker deployment, and current limitations. Static hosting remains available without the service.

## Tests

Node 22+ is sufficient; no install required:

```sh
npm test
```

Checks cover unique legal flex assignment, started player locks, negative points, missing projections, league scoring differences, multi-league ownership/opponent deduplication, reserve/taxi availability, protected waiver drops, score changes, weekly and season trade valuation, bye/missing data, value imbalance and negligible opponent gains. The season assignment solver is checked against the existing exact optimizer across 80 deterministic flex/superflex scenarios. Cache tests cover concurrent request deduplication, persistence, expiry, force refresh, failures, bounded memory, league/week isolation, and roster/scoring invalidation.

## Files

- `server/`: optional API/MCP service, SQLite state, scheduler, and ntfy adapter
- `dist/integrations.html`: owner account, schedule, report archive, and notification controls
- `dist/analysis.js`: shared browser/service trade and waiver orchestration
- `dist/app.js`: interface and orchestration
- `dist/api.js`: provider adapters and persistent resource caching
- `dist/cache.js`: shared request cache and bounded computation memoization
- `dist/engine.js`: pure lineup, scoring, trade and aggregation functions
- `dist/waivers.js`: future-week pickup/drop evaluation and horizon selection
- `dist/defenses.js`: five-week windows, median baselines and matchup color bands
- `dist/trades.js`: season lineup assignment, remaining-season impact and realism checks
- `dist/demo.js`: explicitly illustrative sample data
- `dist/styles.css`: responsive presentation

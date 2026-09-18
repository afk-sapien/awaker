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
- League-specific waiver availability, global adds, projected marginal lineup gains and drop candidates.
- Exact position/flex assignment via dynamic programming, started lineup locks, unavailable projections and injury exclusions.
- Manual multi-player trades, one-for-one suggestions across other rosters, adjustable rival penalty, replacement pickup assumptions and roster capacity drops.
- Three-week defense projections and two-defense rotation comparisons.
- Read-only, feature-detected WebMCP watchroom tool.

## Data and limitations

- Official Sleeper API: https://docs.sleeper.com/ (read-only league, roster, player, matchup and trending endpoints). Trending data attributed to Sleeper. API free for noncommercial use; commercial use requires discussing licensing with Sleeper.
- Experimental projections: `https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular`. This endpoint is not part of the documented supported API. It may fail or change. Projections are mapped to league scoring using available stat fields; unmodeled scoring keys are explicitly listed. Nonlinear bonuses and absent projected stats can make estimates incomplete.
- ESPN public scoreboard supplies NFL game state, opponents, broadcast labels and game scores. It is an unofficial dependency with no availability guarantee. Game-live status is not on-field player tracking.
- Actual fantasy scores come from Sleeper matchup `players_points`; different leagues retain separate values. Missing data is displayed as unavailable, never silently shown as zero. Scores can lag broadcasts.
- Advice is deterministic and based on expected points. No calibrated win odds, injury probability model, actual transaction submission, FAAB bid estimation, dynasty/pick valuation, alerts, or rest-of-season trade model yet. Trade estimates are hypothetical pregame comparisons; trades involving started players cannot realize those gains in the selected week. Waiver suggestions prioritize current starting-lineup gains and may undervalue depth.
- All current-season leagues are discoverable. The prototype supports team defenses and ordinary flex/superflex lineups; optimizers are capped at 15 unlocked starting slots. Nonstandard position/scoring rules need further validation.
- A second defense's bench cost is called out but not subtracted from rotation gain. Future missing projections are shown as unavailable; rotation recommendations need all included weeks.
- Username, league exclusions and pinned player IDs are stored locally. Player directory is cached in IndexedDB for 24 hours. Rosters and scores are kept in memory. No secrets are stored.

## Tests

Node 22+ is sufficient; no install required:

```sh
npm test
```

Checks cover unique legal flex assignment, started player locks, negative points, missing projections, league scoring differences, multi-league ownership/opponent deduplication, reserve/taxi availability and marginal trade valuation.

## Files

- `dist/app.js`: interface and orchestration
- `dist/api.js`: provider adapters and player cache
- `dist/engine.js`: pure lineup, scoring, trade and aggregation functions
- `dist/demo.js`: explicitly illustrative sample data
- `dist/styles.css`: responsive presentation

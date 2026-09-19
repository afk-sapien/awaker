# Awaker

Your Sleeper leagues, wide awake.

Awaker is a self-hosted fantasy football companion for following players across leagues, comparing lineups, planning waivers, and finding trades that help both teams. An optional background service adds read-only agent access, scheduled reports, and ntfy notifications.

Awaker is an independent community project, unaffiliated with Sleeper, ESPN, or the NFL. It never asks for a Sleeper password and cannot submit transactions.

## Start on your computer

Install [Node.js 24 LTS](https://nodejs.org/), then run:

```sh
git clone https://github.com/afk-sapien/awaker.git
cd awaker
npm start
```

Open [127.0.0.1:4173](http://127.0.0.1:4173). No dependency install or build step is needed. Node 22.13 or newer is also supported.

The dashboard starts with labeled sample leagues. Choose **Connect Sleeper**, enter your public username, and use **My leagues** to choose leagues. Browser-only mode stores your preferences on your computer.

## Run with Docker

```sh
docker compose up -d --build
```

Open [127.0.0.1:4173](http://127.0.0.1:4173). The container runs as an unprivileged user with a read-only filesystem and binds to loopback. It serves the dashboard without a database or credentials.

You can also serve `dist/` with your own static web server. For a quick Python preview, use `python3 -m http.server 4173 --bind 127.0.0.1 --directory dist`. The bundled Node and Docker servers include security headers that a custom static server must configure separately.

## Enable agents and background updates

```sh
npm run setup
npm run service
```

Setup creates a private `.env` containing distinct owner and agent tokens. It never overwrites an existing file. Open [Agents & updates](http://127.0.0.1:4173/integrations.html), then sign in using `AWAKER_ADMIN_TOKEN` from `.env`. Keep that token out of agent configurations.

For Docker, run setup first, then use:

```sh
docker compose -f compose.service.yaml up -d --build
```

Choose either dashboard-only mode or service mode. Both use port 4173. Schedules and notifications start disabled. The service must remain running for unattended updates.

See [integrations](docs/integrations.md) for MCP, API, scheduling and ntfy setup, and [self-hosting](docs/self-hosting.md) for remote access, backups, upgrades, and migration from Sunday.

## What it does

- A multi-league watchroom with player photos, actual scores, opponent exposure, pins, and focus mode.
- Legal lineup optimization that respects flex slots, started players, injuries, missing projections, and league scoring.
- Waiver planning for this week, next week, or the remaining season, with protected players and drop controls.
- Automated one-for-one trade suggestions and a manual package builder. Suggestions compare both managers' lineup gains with their no-trade pickup alternatives.
- Five-week defense projections and two-defense rotation comparisons.
- Themes for all 32 NFL teams, stored locally in your browser.
- An authenticated API, stdio MCP adapter, scheduled reports, and opt-in ntfy trade alerts.

## Data, privacy, and limits

The browser needs access to `api.sleeper.app`, `site.api.espn.com`, and `sleepercdn.com`. Google Fonts are optional, with system fonts as fallback. Requests go directly to these providers in dashboard-only mode. The service also fetches league data when enabled. There is no bundled analytics or telemetry.

Sleeper usernames, leagues, rosters, and matchups come from the [read-only Sleeper API](https://docs.sleeper.com/). Its documented terms allow noncommercial use. Contact Sleeper about commercial use. Player projections use an experimental, undocumented endpoint that may change or fail. ESPN game status is also an unofficial dependency. Player photos, team names, and external data retain their respective owners' rights.

Advice uses projected points, not calibrated win probabilities. It does not model trade acceptance, dynasty picks, FAAB, transaction deadlines, or all custom scoring bonuses. Future analysis requires actual future projections. Missing estimates are shown as unavailable. Byes are included only when a schedule is available. Optimizers support up to 15 unlocked starting slots.

Scores can lag broadcasts. Visible tabs refresh every 45 seconds. Cached player details can be 24 hours old, so urgent injury alerts are not offered. Trade alerts scan every 15 minutes when enabled and are not a guaranteed real-time feed.

Browser preferences and cached data stay on that browser's origin. Service settings, caches, and reports live in SQLite and can contain private league strategy. API tokens stay in the server environment. The owner token is sent during login, then replaced by an eight-hour HttpOnly session cookie. Protect `.env`, the data volume, and backups.

## Development and release

```sh
npm run verify
node scripts/container-smoke.js
```

The second command requires Docker. CI runs syntax and unit/integration checks on Node 22 and 24, builds and tests both containers, checks persistence through restart, and scans Git history for secrets. Tests use synthetic data and fake notifications.

- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)
- [Release checklist](docs/releasing.md)
- [Changes](CHANGELOG.md)

Source is kept in `dist/` despite the directory name. Edit it directly. Pure calculations live in `engine.js`, `trades.js`, `waivers.js`, `lineup.js`, and `defenses.js`. The optional service is in `server/`. There are no generated bundles or third-party runtime packages.

The public release is being prepared. License selection and repository publication remain maintainer decisions.

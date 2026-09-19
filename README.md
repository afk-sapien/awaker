# Awaker

Your Sleeper leagues, wide awake.

Awaker is a self-hosted fantasy football companion for following players across leagues, comparing lineups, planning waivers, and finding trades that help both teams. An optional background service adds read-only agent access, scheduled reports, and ntfy notifications.

Awaker is an independent community project, unaffiliated with Sleeper, ESPN, or the NFL. It never asks for a Sleeper password and cannot submit transactions.

## Install and launch with Python

Use Python 3.11 or newer. From a clone of this repository, install with [pipx](https://pipx.pypa.io/) and launch:

```sh
pipx install .
awaker
```

Or install with pip inside an activated virtual environment:

```sh
python -m pip install .
awaker
```

Open [127.0.0.1:4173](http://127.0.0.1:4173). The Python package includes the app and automatically installs a Node 24 runtime through [nodejs-wheel-binaries](https://pypi.org/project/nodejs-wheel-binaries/), an unofficial distribution of Node. No separate Node install, npm command, or checkout is needed after installation.

The dashboard starts with labeled sample leagues. Choose **Connect Sleeper**, enter your public username, and use **My leagues** to choose leagues. Browser-only mode stores your preferences on your computer.

`awaker --port 8080` chooses another local port. `python -m awaker` is equivalent to `awaker`. To install directly from GitHub:

```sh
pipx install "git+https://github.com/afk-sapien/awaker.git"
```

While the repository is private, Git must have access to it. The package has not been published to PyPI, so bare `pip install awaker` is not the installation command for this project yet.

## Run with Docker

From the repository checkout:

```sh
docker compose up -d --build
```

Open [127.0.0.1:4173](http://127.0.0.1:4173). The container runs as an unprivileged user with a read-only filesystem and binds to loopback. It serves the dashboard without a database or credentials.

You can also serve `dist/` with your own static web server. For a quick Python preview, use `python3 -m http.server 4173 --bind 127.0.0.1 --directory dist`. The Python launcher, Node launcher, and Docker servers include security headers that a custom static server must configure separately.

## Enable agents and background updates

For a Python installation:

```sh
awaker setup
awaker service
```

Setup creates a private `.env` in your Awaker user-data directory. It never overwrites existing tokens. Open [Agents & updates](http://127.0.0.1:4173/integrations.html), then sign in using `AWAKER_ADMIN_TOKEN` from the file printed by setup. Keep that token out of agent configurations. `awaker mcp` starts the stdio agent adapter.

For Docker, copy `.env.example` to `.env` in the checkout and configure two distinct tokens as described in [self-hosting](docs/self-hosting.md), then run:

```sh
docker compose -f compose.service.yaml up -d --build
```

Choose either dashboard-only mode or service mode. Both use port 4173. Schedules and notifications start disabled. The service must remain running for unattended updates.

Developers with Node 24 installed can still use `npm start`, or `npm run setup` followed by `npm run service`, directly from the checkout. These commands use the checkout's `.env` and `data/`, separate from a Python installation's user data.

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

The second command requires Docker. CI runs syntax and unit/integration checks on Node 22 and 24, builds and tests both containers, checks persistence through restart, and scans Git history for secrets. Python CI builds a source archive and wheel, installs the wheel, and tests launch and persistence on Linux, macOS, and Windows without system Node on PATH. Tests use synthetic data and fake notifications.

- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)
- [Release checklist](docs/releasing.md)
- [Changes](CHANGELOG.md)

Source is kept in `dist/` despite the directory name. Edit it directly. Pure calculations live in `engine.js`, `trades.js`, `waivers.js`, `lineup.js`, and `defenses.js`. The optional service is in `server/`. There are no generated bundles or third-party JavaScript runtime packages. The Python launcher depends on the packaged Node runtime.

Awaker is licensed under the [MIT License](LICENSE). External data, player photos, and third-party names and trademarks retain their respective owners' rights.

# Awaker

**Your Sleeper leagues, wide awake.**

Follow all your fantasy football teams in one place. Compare lineups, find waiver upgrades, and see what a trade does for both managers. Run Awaker on your computer or your own server.

[![CI](https://github.com/afk-sapien/awaker/actions/workflows/ci.yml/badge.svg)](https://github.com/afk-sapien/awaker/actions/workflows/ci.yml)
[![Container publishing](https://github.com/afk-sapien/awaker/actions/workflows/release-containers.yml/badge.svg)](https://github.com/afk-sapien/awaker/actions/workflows/release-containers.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-limegreen.svg)](LICENSE)

![Awaker watchroom showing three sample leagues and player scores across teams](docs/images/watchroom.png)

*Real app, illustrative demo data. No Sleeper password, subscription, or transactions required.*

[Quick start](#quick-start) · [Self-hosting](docs/self-hosting.md) · [Agents and notifications](docs/integrations.md) · [Releases](https://github.com/afk-sapien/awaker/releases)

## What you can do

- **Watch every league together.** Track your players and opponents, pin favorites, and switch to focus mode on game day.
- **Make your lineup count.** Compare starters and bench players with league scoring, flex eligibility, and started-game locks.
- **Plan the next move.** Explore waivers, trade ideas, package comparisons, and defense rotations.
- **Keep an eye on things while away.** Enable the optional service for scheduled reports, read-only agent tools, and opt-in ntfy notifications.
- **Make it yours.** Choose colors for any of the 32 NFL teams.

<details>
<summary>See the trade builder</summary>

![Sample trade comparing the projected gain for both managers and showing trade warnings](docs/images/trade-builder.png)

A trade can help you while hurting the other manager. Awaker shows both sides and compares available pickup alternatives. Projections are estimates.

</details>

## Quick start

Start with the dashboard. It opens with sample leagues so you can explore before connecting an account.

| You want to… | Start here |
| --- | --- |
| Run it on your computer | Python install below |
| Run a prebuilt container | Docker below |
| Get reports and connect an agent | [Enable the background service](#enable-the-background-service) |
| Develop or build from source | [Development](#development) |

### Python

You need **Python 3.11+**, **Git**, and [pipx](https://pipx.pypa.io/stable/installation/).

```sh
pipx install "git+https://github.com/afk-sapien/awaker.git"
awaker
```

Open **[http://127.0.0.1:4173](http://127.0.0.1:4173)**. Leave the terminal running while using the app. Press Ctrl+C to stop it.

The install includes Awaker and automatically installs a Node 24 runtime. You do not need to install Node separately. `awaker --port 8080` changes the port, and `python -m awaker` also launches the app.

<details>
<summary>Prefer pip and a virtual environment?</summary>

```sh
python -m venv .venv
```

Activate it with `source .venv/bin/activate` on Linux/macOS, or `.venv\Scripts\Activate.ps1` in Windows PowerShell. Then:

```sh
python -m pip install "git+https://github.com/afk-sapien/awaker.git"
awaker
```

From a repository checkout, `python -m pip install .` works too.

</details>

This project is not published to PyPI yet. Use the Git URL or a checkout, not bare `pip install awaker`. While the repository is private, your Git account needs access. The bundled runtime is supplied by the unofficial [nodejs-wheel-binaries](https://pypi.org/project/nodejs-wheel-binaries/) package. See [supported platforms and upgrades](docs/self-hosting.md#python-installation).

### Docker

With Docker installed, run the prebuilt dashboard:

```sh
docker run -d --name awaker --restart unless-stopped --init \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  -p 127.0.0.1:4173:4173 \
  ghcr.io/afk-sapien/awaker:edge
```

Open **[http://127.0.0.1:4173](http://127.0.0.1:4173)**. Stop it with `docker stop awaker` and start it again with `docker start awaker`. Images support Linux AMD64 and ARM64, including Docker Desktop.

`edge` is the tested preview channel. Tagged GitHub releases publish versioned images, and stable releases also publish `latest`. For dependable deployments, pin a published version or digest. **Private packages require a GitHub login with package read access.** See [registry access, Compose, and upgrades](docs/self-hosting.md#prebuilt-containers). Building locally remains available with `docker compose up -d --build` from a checkout.

### Connect your leagues

1. Click **Connect Sleeper** and enter your public Sleeper username.
2. Open **My leagues** to choose which leagues appear.
3. Use the watchroom for scores, then try **Start / sit**, **Waiver wire**, or **Auto trades**.

Awaker reads public league data. Make roster changes and transactions in Sleeper. Dashboard preferences stay in your browser, so use the same address each time. `localhost` and `127.0.0.1` have separate browser storage.

## Enable the background service

The service adds persistent settings, scheduled reports, an authenticated API, and MCP tools for agents. It is optional and designed for one owner.

With a Python installation:

```sh
awaker setup
awaker service
```

Stop the dashboard first because both modes use port 4173. Setup prints the location of a private `.env` file containing two generated tokens. Open **[Agents & updates](http://127.0.0.1:4173/integrations.html)** and sign in with `AWAKER_ADMIN_TOKEN`. Keep this owner token private. Agent clients use the separate `AWAKER_AGENT_TOKEN`, and `awaker mcp` starts their stdio adapter.

For Docker, use `ghcr.io/afk-sapien/awaker-service:edge` with the [service Compose file](compose.ghcr.service.yaml) and follow the [token setup instructions](docs/self-hosting.md). The service keeps its database in a Docker volume.

Schedules and notifications start disabled. Keep the service running for unattended updates. Configure HTTPS before remote access. See [self-hosting](docs/self-hosting.md) for configuration and backups, and [integrations](docs/integrations.md) for agents, schedules, and ntfy.

## Data, privacy, and limits


The browser needs access to `api.sleeper.app`, `site.api.espn.com`, and `sleepercdn.com`. Google Fonts are optional, with system fonts as fallback. Requests go directly to these providers in dashboard-only mode. The service also fetches league data when enabled. There is no bundled analytics or telemetry.

Sleeper usernames, leagues, rosters, and matchups come from the [read-only Sleeper API](https://docs.sleeper.com/). Its documented terms allow noncommercial use. Contact Sleeper about commercial use. Player projections use an experimental, undocumented endpoint that may change or fail. ESPN game status is also an unofficial dependency. Player photos, team names, and external data retain their respective owners' rights.

Advice uses projected points, not calibrated win probabilities. It does not model trade acceptance, dynasty picks, FAAB, transaction deadlines, or all custom scoring bonuses. Future analysis requires actual future projections. Missing estimates are shown as unavailable. Byes are included only when a schedule is available. Optimizers support up to 15 unlocked starting slots.

Scores can lag broadcasts. Visible tabs refresh every 45 seconds. Cached player details can be 24 hours old, so urgent injury alerts are not offered. Trade alerts scan every 15 minutes when enabled and are not a guaranteed real-time feed.

Browser preferences and cached data stay on that browser's origin. Service settings, caches, and reports live in SQLite and can contain private league strategy. API tokens stay in the server environment. The owner token is sent during login, then replaced by an eight-hour HttpOnly session cookie. Protect `.env`, the data volume, and backups.

Awaker is an independent community project, unaffiliated with Sleeper, ESPN, or the NFL.

## Development

With Node 24 installed, clone the repository and run `npm start`. Source lives in `dist/` despite the directory name. There is no frontend build step and no third-party JavaScript runtime dependency to install.

```sh
npm run verify
node scripts/container-smoke.js
node scripts/scan-images.js
```

The last two commands require Docker. CI tests Node 22 and 24, installed Python packages on Linux/macOS/Windows, and both containers on AMD64/ARM64. It scans Git history for secrets and container packages for known vulnerabilities. Weekly checks catch newly disclosed container vulnerabilities, and publication is blocked on HIGH or CRITICAL findings.

The [Publish containers workflow](.github/workflows/release-containers.yml) runs the same checks before pushing to GHCR. Published images include build provenance and a software bill of materials. See [release instructions](docs/releasing.md).

[Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Getting help](SUPPORT.md) · [Security reporting](SECURITY.md) · [Changelog](CHANGELOG.md)

Awaker is licensed under the [MIT License](LICENSE). External data, player photos, and third-party names and trademarks retain their respective owners' rights.

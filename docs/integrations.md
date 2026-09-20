# Agent access and notifications

The optional background service provides an authenticated JSON API, a stdio MCP adapter, daily/weekly summaries, and ntfy alerts for strong new trade and waiver opportunities. Static hosting still works with `npm start`. Unattended integrations require the service to stay running.

## Python installations

After installing the Python package, run `awaker setup`, then `awaker service`. Setup prints the location of the private configuration file. `awaker mcp` runs the agent adapter using the bundled runtime. See [Python installation and data locations](self-hosting.md#python-installation) for configuration, upgrades, and migration from a checkout-based service.

## Run locally from a Node checkout

1. Use Node **24 LTS** (or 22.13 or newer). No package installation is needed.
2. Run `npm run service` and open `http://127.0.0.1:4173/integrations.html`. There is no login by default. Use the exact host configured by `AWAKER_PUBLIC_URL`. `localhost` and `127.0.0.1` are different origins.
3. To require a sign-in, run `npm run setup` to write `.env` with two distinct tokens, or create them yourself with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` run twice, then restart. Keep the owner token out of agent configuration, and set only the agent token in an MCP client.
4. The page shows the configured account. Optionally import the analysis preferences already saved in this browser on this origin. Save settings. Choose excluded league IDs, daily/weekly schedules, timezone, and alert thresholds. Schedules and alerts start disabled.
5. To receive pushes, open **Phone notifications** on the same page. No ntfy account is needed: keep the default `https://ntfy.sh` server, use **Generate a random topic**, save, subscribe to the shown address in the ntfy app, and use **Send test notification**, which reports whether ntfy accepted it and why not. On a public server the topic name is the only secret, so keep it unguessable. A self-hosted server and an access token for a protected topic are optional. Changes apply immediately, without a restart. Without ntfy, scheduled reports are archived in the app.

`AWAKER_HOST` defaults to loopback. `PORT` defaults to 4173. Update `AWAKER_PUBLIC_URL` and `AWAKER_API_URL` if you change it. `SLEEPER_USERNAME` is required and fixes the account the service reports on. The browser and API cannot change it, which keeps an open service delivering notifications for your leagues only. `awaker service --username NAME` sets it from the command line. `NTFY_URL`, `NTFY_TOPIC` and `NTFY_TOKEN` still work as defaults: only the topic is required, and they apply until notification settings are saved in the browser, which then take over. **Forget these settings** returns to them. SQLite state defaults to `data/awaker.sqlite`, overridable with `AWAKER_DB`. The service uses Node's built-in SQLite support, which Node 22 labels experimental.

With tokens configured, the owner signs in using an eight-hour, HttpOnly, SameSite=Strict cookie. Sessions expire on service restart. Agent credentials authorize only the five analysis capabilities below. Rotate either token in the environment and restart to revoke it. API and ntfy tokens are never returned to the browser, stored in browser preferences, or included in reports. A saved ntfy token lives in the service database, can be replaced or removed but not read back, and is discarded when the ntfy server changes so it is never sent to a different host. Serve remote access through a TLS reverse proxy. Preserve the configured Host header. HTTPS is required for remote ntfy and MCP-to-API connections.

## Connect a coding agent

Configure a generic stdio MCP server using an absolute path to `server/mcp.js`, a Node executable, and these environment variables:

```json
{
  "mcpServers": {
    "awaker": {
      "command": "node",
      "args": ["/absolute/path/to/awaker/server/mcp.js"],
      "env": {
        "AWAKER_API_URL": "http://127.0.0.1:4173",
        "AWAKER_AGENT_TOKEN": "YOUR_READ_ONLY_AGENT_TOKEN"
      }
    }
  }
}
```

Adapt the container format to your agent's MCP configuration. The service runs separately. Launching the adapter does not start the service. Use `node server/mcp.js` directly for stdio transports so package-runner banners cannot pollute protocol output. It supports MCP revisions 2025-03-26, 2025-06-18, and 2025-11-25, newline-delimited JSON-RPC, initialization, ping, tools/list, and tools/call. Protocol logs go to stderr. Remote HTTP MCP transport is not implemented.

| MCP tool | API route | Input |
| --- | --- | --- |
| `get_status` | `GET /api/v1/status` | Optional `leagueId` |
| `find_trades` | `POST /api/v1/trades/search` | Optional `leagueId`, `limit` (1–50), incoming `positions` |
| `evaluate_trade` | `POST /api/v1/trades/evaluate` | `leagueId`, integer `partnerId`, `give` and `get` player-ID arrays |
| `get_opportunities` | `GET /api/v1/opportunities` | Optional `leagueId` |
| `preview_digest` | `POST /api/v1/digests/preview` | Optional `period`: `daily` or `weekly` |

HTTP callers send `Authorization: Bearer <agent token>` when tokens are configured, and no header when they are not. GET inputs are query parameters. POST inputs are JSON. Unknown fields, invalid player packages, and excluded leagues are rejected. Example requests in natural language: “Find mutually beneficial trades in my leagues,” “Show my current matchups and player status,” or “Preview this week's summary.” Previews never send notifications.

Responses include schema version, season/week, source fetch times, available upstream timestamps, demo status, completeness, and warnings. Missing projections remain unavailable. Searches reuse the browser's trade and waiver engines, retain owner protections, and cap each league's trade search at 10,000 pairs. Results explain both managers' projected gains and realism checks. Every capability is read-only toward Sleeper.

## Scheduling and alert behavior

The worker wakes every minute. Enabled daily and weekly reports use the owner's timezone. Daylight-saving repeated times are delivered once and skipped local times run after the clock transition. Schedule activation starts with the next occurrence. After downtime, missed dates coalesce into one current report per enabled cadence. Changing schedule/account/timezone establishes a new schedule baseline. Ordinary analysis preference changes preserve schedule history.

Reports contain matchup status, up to three lineup/waiver/trade recommendations, changes since the previous successfully delivered or archived report, and limitations. Weekly reports are current weekly briefings, not a reconstructed historical transaction log. The archive retains 50 reports. Starting the service with a different `SLEEPER_USERNAME` clears the previous account's report and event history.

Opportunity scans run every 1, 3, 6, 12, or 24 hours (default six) when trade or waiver alerts are enabled, and **Scan now** runs one on demand under the same rules. Trades and waiver pickups have separate toggles and thresholds. A trade must pass the owner's existing minimum gain and value-balance rules and the trade threshold (default +3 projected points/week). A waiver pickup comes from the same engine as the waiver view and `get_opportunities`, honoring protected players and drop rules, and must clear the pickup threshold (default +3 projected points **this week**). When several free agents would replace the same drop, only the best one counts.

The first complete non-demo scan of each kind, and the first after the NFL week changes, establishes a baseline without notifying. After that an opportunity is new when its league, players, and partner or drop have not been seen in the current scans. Repeat alerts require a material improvement (default +2 points), a six-hour cooldown, and room under the daily cap (default three). Everything new in one scan is sent as **one** notification, such as "Awaker: 2 trades, 1 waiver pickup", listing the top five by projected gain and linking to the relevant view, and it counts once against the daily cap. A scan during quiet hours holds its findings and rescans in the first minute after they end. Findings held by the daily cap or a missing ntfy connection go out with a later scan. If one kind's data is incomplete, that kind is skipped and the other still runs. Preferences/account/alert-setting changes reset the baseline and cancel queued alerts. **Background activity** shows the last scan, what it found, and when the next is due.

Pending alerts recheck current rosters and every listed opportunity before delivery and drop the ones that no longer qualify. Incomplete, stale, demo, expired, or no-longer-qualifying results do not send. Opportunity messages expire after six hours. Scheduled digest deliveries expire after 24 hours. Failed deliveries retry up to five attempts with bounded exponential backoff. The archive and background activity panel show pending, accepted, failed, cancelled, or expired delivery. Acceptance means ntfy accepted the request, not that a phone displayed it. A network timeout can still produce a duplicate push.

## Deployment and recovery

```sh
docker compose up -d
```

The single image runs the dashboard and the service on Node, with a persistent `sunday-data` volume. Run **one service instance per SQLite database**. The worker is guarded against overlapping runs within that process, not distributed replicas. The included compose file binds port 4173 to host loopback. No deployment is performed automatically.

Stop the service before copying the SQLite database for backup, or use a SQLite-aware backup tool. Preserve the database and environment across upgrades. Losing the database loses report history, preferences, and event deduplication state. Startup establishes a fresh event baseline on a new database. An owner-token rotation invalidates sessions on restart. Report archives and snapshots may contain personal league strategy. Protect the data volume and backups.

## Current limits

- **Urgent injury/inactive alerts remain disabled:** the current player directory is cached for 24 hours. A reliable timely source is required before promising this behavior.
- **Alert horizons.** Waiver alerts can judge a pickup by this week, next week, or the average week over the rest of the season, using the same engine as the waiver view. Trade alerts are always searched over the rest of the season and can be judged by the average week or by next week alone. Neither knows FAAB, waiver priority, or league-specific claim deadlines.
- Source refresh policies still apply: player details 24 hours, projections/future schedules one hour, trends 15 minutes. Rosters/scores refresh more often on demand. “Immediate” means after a qualifying provider update is detected. It is not a live injury feed.
- The service follows the current NFL week. Static browser mode retains historical week selection. In connected mode the server owns account, league selection, and analysis preferences. Refresh the page after changing those settings in another tab. Display-only pins and filters remain browser-local.
- Source outages and unsupported scoring can pause alerts. Projections are experimental expected-point estimates. Trades are not submitted and acceptance, wins, dynasty value, or draft-pick value are not predicted.

## Verification

`npm test` covers existing fantasy calculations plus SQLite recovery, API role boundaries, MCP negotiation and validation, schedule activation, DST rollback and skipped times, missed-run coalescing, scan intervals, trade and waiver event baselines, digest grouping, quiet hours and the daily cap, cooldowns, demo/stale suppression, delivery retries, and ntfy settings (optional token, environment fallback, validation, and token non-disclosure). All notification tests use a fake transport. Browser verification uses synthetic sample data. Live phone delivery requires the owner's ntfy configuration and device subscription.

Protocol references: [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [ntfy publishing and authentication](https://docs.ntfy.sh/publish/).

See [self-hosting](self-hosting.md) for reverse proxy configuration, backup, and legacy Sunday migration details.

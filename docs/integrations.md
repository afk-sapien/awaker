# Agent access and notifications

The optional background service provides an authenticated JSON API, a stdio MCP adapter, daily/weekly summaries, and ntfy alerts for strong new trade opportunities. Static hosting still works with `npm start`; unattended integrations require the service to stay running.

## Run locally

1. Use Node **22.13 or newer**. No package installation is needed. Copy `.env.example` to `.env` and restrict it to your user (`chmod 600 .env`).
2. Generate **two distinct random tokens**, running `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` twice. Set `SUNDAY_ADMIN_TOKEN` and `SUNDAY_AGENT_TOKEN` in `.env`. Keep the owner token out of agent configuration.
3. Run `npm run service`. Open `http://127.0.0.1:4173/integrations.html` and sign in with the owner token. Use the exact host configured by `SUNDAY_PUBLIC_URL`; `localhost` and `127.0.0.1` are different origins.
4. Enter a public Sleeper username, or import the account and analysis preferences already saved in this browser on this origin. Save settings. Choose excluded league IDs, daily/weekly schedules, timezone, and alert thresholds. Schedules and alerts start disabled.
5. To receive pushes, set **all three** `NTFY_URL`, `NTFY_TOPIC`, and `NTFY_TOKEN`, then restart the service. Use an access-controlled topic on your chosen ntfy host. Subscribe on your phone and use **Send test notification** to check delivery. Without ntfy, scheduled reports are archived in the app.

`SUNDAY_HOST` defaults to loopback. `PORT` defaults to 4173; update `SUNDAY_PUBLIC_URL` and `SUNDAY_API_URL` if you change it. `SLEEPER_USERNAME` optionally initializes an empty installation. SQLite state defaults to `data/sunday.sqlite`, overridable with `SUNDAY_DB`. The service uses Node's built-in SQLite support, which Node 22 labels experimental.

The owner signs in using an eight-hour, HttpOnly, SameSite=Strict cookie. Sessions expire on service restart. Agent credentials authorize only the five analysis capabilities below. Rotate either token in the environment and restart to revoke it. API and ntfy tokens are never returned to the browser, stored in browser preferences, or included in reports. Serve remote access through a TLS reverse proxy; preserve the configured Host header. HTTPS is required for remote ntfy and MCP-to-API connections.

## Connect a coding agent

Configure a generic stdio MCP server using an absolute path to `server/mcp.js`, a Node executable, and these environment variables:

```json
{
  "mcpServers": {
    "sunday": {
      "command": "node",
      "args": ["/absolute/path/to/Awaker-agent-notifications/server/mcp.js"],
      "env": {
        "SUNDAY_API_URL": "http://127.0.0.1:4173",
        "SUNDAY_AGENT_TOKEN": "YOUR_READ_ONLY_AGENT_TOKEN"
      }
    }
  }
}
```

Adapt the container format to your agent's MCP configuration. The service runs separately; launching the adapter does not start the service. Use `node server/mcp.js` directly for stdio transports so package-runner banners cannot pollute protocol output. It supports MCP revisions 2025-03-26, 2025-06-18, and 2025-11-25, newline-delimited JSON-RPC, initialization, ping, tools/list, and tools/call. Protocol logs go to stderr. Remote HTTP MCP transport is not implemented.

| MCP tool | API route | Input |
| --- | --- | --- |
| `get_status` | `GET /api/v1/status` | Optional `leagueId` |
| `find_trades` | `POST /api/v1/trades/search` | Optional `leagueId`, `limit` (1–50), incoming `positions` |
| `evaluate_trade` | `POST /api/v1/trades/evaluate` | `leagueId`, integer `partnerId`, `give` and `get` player-ID arrays |
| `get_opportunities` | `GET /api/v1/opportunities` | Optional `leagueId` |
| `preview_digest` | `POST /api/v1/digests/preview` | Optional `period`: `daily` or `weekly` |

HTTP callers send `Authorization: Bearer <agent token>`. GET inputs are query parameters; POST inputs are JSON. Unknown fields, invalid player packages, and excluded leagues are rejected. Example requests in natural language: “Find mutually beneficial trades in my leagues,” “Show my current matchups and player status,” or “Preview this week's summary.” Previews never send notifications.

Responses include schema version, season/week, source fetch times, available upstream timestamps, demo status, completeness, and warnings. Missing projections remain unavailable. Searches reuse the browser's trade and waiver engines, retain owner protections, and cap each league's trade search at 10,000 pairs. Results explain both managers' projected gains and realism checks. Every capability is read-only toward Sleeper.

## Scheduling and alert behavior

The worker wakes every minute. Enabled daily and weekly reports use the owner's timezone; daylight-saving repeated times are delivered once and skipped local times run after the clock transition. Schedule activation starts with the next occurrence. After downtime, missed dates coalesce into one current report per enabled cadence. Changing schedule/account/timezone establishes a new schedule baseline; ordinary analysis preference changes preserve schedule history.

Reports contain matchup status, up to three lineup/waiver/trade recommendations, changes since the previous successfully delivered or archived report, and limitations. Weekly reports are current weekly briefings, not a reconstructed historical transaction log. The archive retains 50 reports. Changing the Sleeper username clears the previous account's report and event history.

Trade scans run every 15 minutes when enabled. The first complete non-demo scan establishes a baseline. A new trade must pass the owner's existing minimum gain and value-balance rules and the alert threshold (default +3 projected points/week). Repeat alerts require a material improvement (default +2 points/week), a six-hour cooldown, and room under the daily cap (default three). Quiet hours defer qualifying opportunities. Preferences/account changes reset the baseline and cancel queued trade alerts.

Pending trade alerts recheck current rosters and trade qualification before delivery. Incomplete, stale, demo, expired, or no-longer-qualifying results do not send. Trade messages expire after six hours; scheduled digest deliveries expire after 24 hours. Failed deliveries retry up to five attempts with bounded exponential backoff. The archive and background activity panel show pending, accepted, failed, cancelled, or expired delivery. Acceptance means ntfy accepted the request, not that a phone displayed it; a network timeout can still produce a duplicate push.

## Deployment and recovery

```sh
docker compose -f compose.service.yaml up -d --build
```

The optional service image uses Node and a persistent `sunday-data` volume. The original `Dockerfile` remains the static nginx deployment. Run **one service instance per SQLite database**; the worker is guarded against overlapping runs within that process, not distributed replicas. The included compose file binds port 4173 to host loopback. No deployment is performed automatically.

Stop the service before copying the SQLite database for backup, or use a SQLite-aware backup tool. Preserve the database and environment across upgrades; losing the database loses report history, preferences, and event deduplication state. Startup establishes a fresh event baseline on a new database. An owner-token rotation invalidates sessions on restart. Report archives and snapshots may contain personal league strategy; protect the data volume and backups.

## Current limits

- **Urgent injury/inactive alerts remain disabled:** the current player directory is cached for 24 hours. A reliable timely source is required before promising this behavior.
- **Waiver and lineup opportunities appear in digests**, not immediate pushes. Reliable league-specific transaction/lock deadlines are required for deadline-qualified waiver alerts. Background failures appear in the activity panel; independent service-down notifications are not yet implemented.
- Source refresh policies still apply: player details 24 hours, projections/future schedules one hour, trends 15 minutes; rosters/scores refresh more often on demand. “Immediate” means after a qualifying provider update is detected. It is not a live injury feed.
- The service follows the current NFL week. Static browser mode retains historical week selection. In connected mode the server owns account, league selection, and analysis preferences; refresh the page after changing those settings in another tab. Display-only pins and filters remain browser-local.
- Source outages and unsupported scoring can pause alerts. Projections are experimental expected-point estimates; trades are not submitted and acceptance, wins, dynasty value, or draft-pick value are not predicted.

## Verification

`npm test` covers existing fantasy calculations plus SQLite recovery, API role boundaries, MCP negotiation and validation, schedule activation, DST rollback and skipped times, missed-run coalescing, event baselines, cooldowns, demo/stale suppression, and delivery retries. All notification tests use a fake transport. Browser verification uses synthetic sample data; live phone delivery requires the owner's ntfy configuration and device subscription.

Protocol references: [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [ntfy publishing and authentication](https://docs.ntfy.sh/publish/).

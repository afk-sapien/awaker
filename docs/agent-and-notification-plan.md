# Agent access, digests, and important-event alerts

Status: proposed; no backend, schedule, or notification delivery is enabled by this plan.

Interpretation of the request: “NFT” means MCP or an API for coding agents, “traits” means trades, and “NFTY” means ntfy. These are working assumptions.

## Product outcome

Agents can inspect connected leagues, player/game status, lineup issues, waiver opportunities, and trade ideas. The owner can optionally receive a daily or weekly summary and separate prompt notifications when a meaningful, actionable opportunity appears. The service keeps working while the browser is closed.

## Current foundation

Sunday is a static app. `dist/app.js` holds browser preferences and orchestration, including trade search; `dist/api.js` fetches provider data; `dist/engine.js` and `dist/trades.js` provide reusable calculations. A feature-detected WebMCP tool exposes the current watchroom in a supporting browser. It does not provide a standalone MCP server or background scheduling.

Visible tabs refresh every 45 seconds. Player-directory data is cached for 24 hours, projections for an hour, and preferences live in browser storage. The current Docker image only serves static files. None of these pieces alone can reliably run unattended digests or urgent monitoring.

## Proposed architecture

Add an optional Node service with SQLite persistence and a background worker. Keep static hosting available; offer a service deployment with a persistent volume for agent access and notifications. Extract shared analysis orchestration from `dist/app.js`, reusing the existing engines so agents and the UI calculate the same results.

The service owns an explicitly configured Sleeper username, selected leagues, scoring/analysis preferences, and notification rules. Provide a one-time import of existing browser preferences and make the service the source of truth in connected mode. Store snapshots, per-source freshness, scheduled runs, event fingerprints, and a delivery outbox durably. Keep credentials in server configuration or a secret store, never in static assets, browser preferences, logs, or agent responses.

Expose a versioned JSON API and a thin MCP adapter over the same application functions. Begin with a local stdio MCP adapter calling the service; bind the service to loopback by default. Require scoped, revocable credentials for API access. A remote MCP deployment is a later option with transport-appropriate authorization and TLS. Scope every request to the configured owner and permitted leagues; validate inputs and bound expensive trade searches.

## Agent contract

| Capability | Proposed API | Proposed MCP tool |
| --- | --- | --- |
| Sync health, enabled leagues, matchups, player/game status | `GET /api/v1/status` | `get_status` |
| Ranked trade opportunities, filtered by league and positions | `POST /api/v1/trades/search` | `find_trades` |
| Evaluate a specified player package | `POST /api/v1/trades/evaluate` | `evaluate_trade` |
| Waiver gains, drop candidates, and lineup issues | `GET /api/v1/opportunities` | `get_opportunities` |
| Generate a daily/weekly report without sending it | `POST /api/v1/digests/preview` | `preview_digest` |

All five capabilities are read-only with respect to fantasy rosters and external communication. Notification settings and delivery remain owner-controlled; analysis calls do not send alerts or submit trades, claims, or lineup changes. Search initially retains the existing one-for-one scope; manual evaluation supports the packages already supported by the engine.

Every response includes schema version, generation time, season/week, per-source fetch times, source update times where available, demo status, completeness, and warnings. Distinguish healthy, degraded, and unavailable data. Missing values remain null; partial results must identify excluded leagues/weeks. Trade results include both managers' projected gains, weekly breakdowns, roster legality, configured filters, and model limitations. Treat player/team names and other provider text as data.

## Optional daily and weekly digests

Settings provide independent daily and weekly toggles, local delivery time, weekly day, IANA timezone, included leagues, and a preview. Start disabled. Allow ntfy delivery and an in-app report archive; email can be a later transport.

Keep each report short: matchup/roster status, up to three ranked actions across leagues, changes since the previous successful report, and any missing data that limits recommendations. Include quantified projected gains and links to the relevant analysis. A scheduled digest may report “No material changes”; immediate alerts stay quiet in that case.

Persist schedule occurrence keys so restarts and daylight-saving changes do not duplicate report generation. Generate reports from current data at run time. Retry failed deliveries with bounded backoff; show last successful run, next run, and delivery failures in settings. After downtime, coalesce missed occurrences into one current report instead of sending a backlog.

## Important-event alerts through ntfy

Configure server URL, protected topic, and server-held publish credential. ntfy supports HTTP publishing, message priorities, and click links; use a topic with access control because a topic name alone does not provide private delivery. Provide a settings test button and delivery status. The owner selects which event classes are enabled.

| Event | Initial proposed qualification | Delivery |
| --- | --- | --- |
| Newly actionable waiver addition | Still available in that league; legal add/drop respects protections; at least +3 projected starting points this week | High priority if an evidenced deadline is within 24 hours; otherwise digest |
| Strong new trade opportunity | Both managers meet existing minimum gains; value-gap and roster checks pass; owner gains at least +3 points/week | Digest by default; immediate high-priority alert if owner enables this class |
| Starter becomes unavailable | Fresh, trustworthy status change; affected upcoming starter; legal replacement exists | High priority before that player's lineup lock |
| Material service failure | Repeated failures prevent enabled monitoring or report delivery | In-app status; one notification through a working channel if configured |

Thresholds are starting proposals, adjustable per league. Preserve the app's existing minimum-benefit, position, roster-protection, and value-balance settings. Show the action, affected league(s), evidence, estimated gain, data timestamp, and a link that opens the relevant view. Add stable URLs for these views during implementation; current navigation is browser state.

Persist event identities using owner, league, event type, affected players, and relevant week/window. Initial synchronization establishes a baseline. Alert only when an opportunity becomes newly qualifying or materially improves (proposed: an additional +2 projected points in the same measurement window). Start with a six-hour cooldown per opportunity and a three-alert daily cap; group related changes and make limits configurable. Quiet hours apply unless the owner explicitly enables exceptions for time-sensitive events.

Revalidate ownership, availability, deadlines, and required projections immediately before delivery. Expire queued messages when their action window closes. Use a durable outbox with retry limits and record provider acceptance separately from confirmed device delivery. Network ambiguity can still cause duplicate pushes; do not promise exactly-once delivery. If ntfy fails, retain the report and surface the failure in the app.

## Freshness and delivery limits

“Immediate” means promptly after a fresh source update is detected. Provider latency, polling, network access, and phone notification settings affect arrival time. Start routine roster/opportunity checks every 15 minutes and consider five-minute checks near known action windows, within provider limits; reuse cached data and recompute only when relevant inputs change. Expensive season trade searches run after roster/projection changes, with a bounded frequency.

The current 24-hour player directory cannot support urgent injury/inactive alerts. Keep that alert class disabled until a suitable timely status source and its allowed refresh policy are validated. Refreshing the large player directory every few seconds is not a substitute. Require reliable lock/deadline information before labeling an action time-sensitive.

The experimental projection feed and unofficial scoreboard can fail. Suppress dependent opportunity alerts when data is stale, incomplete, or unavailable; do not extrapolate missing future weeks. Existing trade gains are expected-point estimates, not acceptance probabilities or guaranteed wins. Live score changes alone do not count as helpful opportunities. Demo data never produces external notifications.

## Implementation order and acceptance checks

1. **Shared service and persistence:** Extract analysis orchestration, implement account/preferences storage and durable snapshots, and support browser-closed operation. Verify existing UI/engine results match service results on the same fixtures; preserve static mode.
2. **API and MCP:** Implement the five capabilities with schemas, bounded requests, credentials, and explicit freshness. Verify an agent can inspect status, discover trades, and evaluate a package; reject unauthorized league access and invalid packages.
3. **Scheduled digests:** Add settings, preview, archive, timezone scheduling, and delivery outbox. Use a fake clock/transport to verify daily/weekly runs, DST, restarts, missed-run coalescing, and delivery retries.
4. **ntfy event alerts:** Add the publisher, event rules, links, deduplication, cooldowns, quiet hours, and fresh-data gates. Verify one qualifying change queues one alert, unchanged refreshes remain quiet, expired opportunities are dropped, and unavailable data never creates an opportunity.
5. **Deployment and owner setup:** Package the optional service/worker with persistent storage and document recovery. Owner supplies a running host, ntfy destination/credential, digest preferences, and alert thresholds before delivery is enabled. Validate a test notification and scheduled report on that installation.

## References

- [MCP server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts): tools and resources for agent access.
- [ntfy publishing](https://docs.ntfy.sh/publish/): publishing, priorities, click actions, authentication, and topic privacy.
- [Sleeper API documentation](https://docs.sleeper.com/): provider capabilities and usage limits; recheck before selecting polling policies.

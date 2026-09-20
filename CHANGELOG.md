# Changelog

## Unreleased

- Show each player's face and jersey number beside their name on the waiver wire,
  Start / sit, trade offers and the trade builder, using the watchroom's portrait.
- Set up phone notifications in the browser with no ntfy account. **Agents & updates** now edits
  the ntfy server (default `https://ntfy.sh`), topic and an optional access token, generates a
  random topic, shows the address to subscribe to, and sends a test that reports why ntfy
  refused it. Changes apply without a restart. `NTFY_URL`, `NTFY_TOPIC` and `NTFY_TOKEN` remain
  as defaults until something is saved, only the topic is required, and a saved token is never
  returned by the API and is dropped when the server changes. On a service without owner tokens,
  anyone who can reach it can now change where notifications go.
- Scan for opportunities every 6 hours by default (1, 3, 6, 12 or 24) instead of every 15
  minutes, and cover waiver pickups as well as trades, each with its own toggle and minimum
  projected gain. Everything new in a scan arrives as one notification, such as
  "Awaker: 2 trades, 1 waiver pickup". Findings held by quiet hours are sent when they end.
  Settings shows the last scan, what it found and when the next is due, and adds **Scan now**.
- Make the Docker quick start a single command with a data volume, and document moving from
  the two 0.2.0 containers to the single image.
- Make the background service's owner and agent tokens optional. Without them there is
  no login, which suits a personal machine or a trusted network. Setting both keeps the
  previous owner and agent roles for a service reachable more widely, and setting only
  one is still rejected.
- Skip a missing `.env` in the service Compose files instead of failing to start.
- Collapse the dashboard and the background service into one application and one image.
  Starting it serves the dashboard; setting `SLEEPER_USERNAME` also runs the API and
  scheduled reports. The separate `awaker-service` image, `compose.service.yaml` and
  `compose.ghcr*.yaml` files are gone, replaced by `compose.yaml` plus `compose.build.yaml`.
- Require `SLEEPER_USERNAME` (or `awaker service --username NAME`) to start the background
  service, and fix the reported account at startup. It can no longer be changed through the
  browser or API, so an open service keeps reporting on your leagues only. The startup message
  names the account an existing database already used.
- Drop the launcher's demand for tokens before starting the service, which the optional-token
  change had left in place.

## 0.2.0

- Add GHCR publication for dashboard and service images on AMD64 and ARM64, gated by CI and vulnerability scans, with provenance and SBOMs.
- Remove vulnerable unused package-manager dependencies from pinned runtime images.
- Bound provider responses, MCP input, and concurrent HTTP analysis. Reject inherited schema fields and invalid timezone types.
- Add weekly image vulnerability scans and GHCR Compose examples.
- Rewrite onboarding with Python and Docker quick starts and real demo screenshots.

- Add a pip/pipx-installable launcher with bundled Node, persistent user configuration, and installed-wheel CI on Linux, macOS, and Windows.

- License Awaker under MIT.
- Rename the application to Awaker with updated branding, favicon, MCP identity, and configuration examples.
- Preserve existing browser preferences, legacy environment variables, and SQLite databases.
- Add a Node-only dashboard launch command and safe first-run token generation.
- Harden HTTP authentication, JSON body limits, static file access, security headers, and shutdown handling.
- Add a minimal service health endpoint and unprivileged Docker deployments.
- Add CI for Node 22 and 24, container startup and persistence, and full-history secret scanning.
- Document hosting, backup, migration, contribution, security reporting, and release steps.

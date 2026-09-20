# Changelog

## Unreleased

- Add a League outlook page. The rest of the schedule is played out 4,000 times to give every team
  its odds of making the playoffs, earning a bye and winning the title, its projected wins, what
  winning or losing this week does to those odds, and its likely final seed. It follows the
  league's own playoff size, median game and divisions. Power rankings blend results so far with
  the best lineup each roster projects to field, and results earn more weight as weeks pile up.
  The page also shows all-play record, luck, the schedule left, where each team's points come from
  by position (for the season so far or the roster ahead), results plotted against roster strength,
  and every weekly score against the league average.
- League outlook draws team shapes: a radar with one corner per position and the league average as
  a ring, so strengths stick out and holes cave in. Your team is always drawn, up to four others
  can be laid over it in their own colors, and everyone else can sit behind in grey. A table beside
  it gives the same numbers. Below it, a depth chart shows every team's QB, RB1, RB2, WR1 and so
  on, with the player and his points a game, colored by where that spot ranks in the league. Both
  follow the same switch between the season so far and the roster ahead.
- Add an Around the league page: every matchup in a league this week with the live score, where
  it is heading, each side's chance to win, who is still to play, the median line in leagues that
  use one, and the standings with playoff odds.
- Auto trades now finds two-for-one and one-for-two packages, the deals where one player for one
  player cannot work for both sides but a second player makes it fair. A package is only tried when
  the side sending two players already gains from each swap alone, the most promising thousand are
  evaluated, and the same deal with a different throw-in is listed once. Whoever receives two and
  has a full roster must cut someone: the offer names the player who never starts, or failing that
  the weakest, and never one of your protected players. The trade builder and the evaluate API
  accept uneven packages the same way, and alerts name your drop.
- The watchroom shows your benched players by default, tagged BN. Untick Show my bench to hide them.
- The Season review now loads after reconnecting in the browser, where it could wait forever.

- Add a Season review page. Every finished week shows what each of your players scored in your
  league's scoring against Sleeper's projection for that week, colored from well under to well
  over. Each player also gets his next three opponents rated Tough, Average or Easy from the points
  they have actually allowed to his position, and a short read such as Rolling, Sell high? or Shop
  or sit, with a shortcut to shop him. It needs two games before it judges anyone.

## 0.3.0

- Shop one player from Auto trades. Choose someone on your roster to see which teams he would
  start for, how much he adds to each lineup, how far he sits above a free agent, and the best
  returns from every team. The other team gains in each offer, and a cost to you is shown as one.
- Keep waiver advice and alerts working when a lineup has a hole. An injured or bye-week starter,
  or one league that has not drafted, used to mark everything incomplete, which hid every waiver
  suggestion in that league and paused background alerts for all leagues.
- Never lose an alert to a short outage. A push that cannot be delivered, or whose recheck cannot
  run, is offered again by the next check, and an opportunity that drops out and returns is not repeated.
- Changing a filter or threshold no longer silently swallows everything that now qualifies.
- Send the dashboard about fifty times less data on each refresh: a trimmed player directory that
  is not resent when unchanged, no unused season outlook, and compressed responses. The service no
  longer rewrites its state every minute or stores multi-megabyte snapshots.
- Shortlist waiver candidates at every position, so quarterbacks and defenses cannot crowd out the
  tight end who would start. Bench upgrades compare like with like, near-equal drops prefer the
  weaker player, and the upgrade bar scales with the window.
- Leagues switched off in My leagues can be switched back on, undrafted leagues are listed as such,
  a signed-out session goes to the sign-in page, a failed first load keeps retrying, and bench alerts
  no longer need waiver alerts to be on.
- Keep alerting when a new NFL week begins. The first check of each week used to be silent,
  which hid waiver pickups exactly when they are actionable. Only the first check after alerts are
  turned on is silent now.
- Back off after a failed background run, from two minutes up to an hour, instead of retrying every minute.
- Hide Switch account and Disconnect in My leagues when the server sets the account, where they
  only led to another page.
- Show a team defense with its team logo instead of initials, everywhere a player portrait appears.
- Stop treating scoring that projections never itemise as an error. It put a warning listing
  scoring keys at the top of every page and marked the data incomplete, which made every
  background check skip trades and waivers. It is now a line under Scoring details.
- Suggest bench upgrades on the waiver wire: a free agent who would not start but projects at
  least a point a week above a bench player your lineup never needs, with the same drop
  protections as lineup pickups. Notifications can include the best one per league, with its own bar.
- Save notification settings as you change them. The Save box is gone, and the page only writes
  the settings it owns, so it can no longer overwrite filters changed on the dashboard.
- Choose how alerts judge a move: trades by the average week over the rest of the season or by
  next week alone, and waiver pickups by this week, next week or the rest of the season.
- Remove the button that copied filters from the browser and the separate league exclusion box.
  Alerts already follow the Auto trades and Waiver wire filters and the leagues turned on in My leagues.
- Give notifications their own page in the sidebar, inside the dashboard's layout. Settings are
  short rows with switches, a status strip shows where pushes go and when the last and next
  checks are, and one Save covers the phone, alerts and summaries.
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

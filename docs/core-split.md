# Sharing awaker's code with a hosted site

A proposal. No code changes are made by this document.

The question: should the engines, analysis, projections, api/cache and the slim-players
generator move into a shared `awaker-core` library, so that this repository and a hosted
WideAwake site build from one package instead of a git submodule plus build-time HTML
injection?

## Recommendation

**No. Keep the submodule and the build-time injection. Replace the four hand-copied
couplings with a small, tested public surface in this repository.**

A package boundary would cost a build step, a registry and a version to track, and would
buy nothing that a documented export list does not already buy. Every concrete pain the
hosted site reported is a missing export or a missing marker, not a missing package.

Reasons, strongest first.

1. **`dist/` is already the library, and it is served verbatim.** The engines are plain ES
   modules with relative imports, zero dependencies, and no DOM or Node use. A browser
   loads them straight off disk. Turning them into a package means either a bundler or a
   copy of `node_modules` inside the served tree. Both break the property the whole
   project is built on, which is that what you read in `dist/` is what the browser runs.
   `scripts/check.js` enforces this today by importing every module and rejecting query
   strings on import specifiers.
2. **There is one consumer.** A library with a single private downstream gets version skew
   and nothing else. A bug found on the hosted site would need a publish round trip
   instead of a submodule bump, and the hosted site would sit on a pinned version that
   drifts from `master`.
3. **Publishing has no good target.** This package is `private: true` and unpublished.
   Going public on npm commits to an API for strangers. Going private means a registry,
   auth and CI secrets, for one reader.
4. **The real coupling is not shared code.** The hosted site scrapes an HTML file for
   string anchors, shells out to a script, imports a constant from a browser module, and
   copies a CSP by hand. A package does not fix any of those. Exporting four things does.
5. **The fixes are wanted by self-hosters too.** A custom app name, a generator that can
   be called from Node, a CSP you can derive instead of transcribe, and static hosting
   without a dead API probe are all features of public awaker. That is the test for
   whether something belongs here rather than in the hosted repository, and all four pass.

### When a package would win

Revisit if any of these becomes true.

- A second independent consumer appears, for example a CLI or a different front end that
  needs the engines without the dashboard.
- The hosted site has to run a different awaker version than the submodule pin, for
  instance to hold back a release while a data provider misbehaves.
- The engines grow a build step of their own, at which point the output is an artifact
  already and publishing it is nearly free.

None of those is true today.

## The module boundary, as a documented contract

The boundary exists physically. It is not written down, so nothing stops it eroding. Draw
it as three tiers and enforce the rule with a check.

**Tier 1, the core.** `dist/engine.js`, `analysis.js`, `trades.js`, `waivers.js`,
`league.js`, `season.js`, `defenses.js`, `lineup.js`, `scouting.js`, `cache.js`,
`network.js`, `api.js`, `themes.js`, `origins.js`, `demo.js`. Pure functions over plain data, plus the
Sleeper and ESPN clients. No Node built-ins, and nothing runs at import time, which is
what lets `scripts/check.js` load every one of them under Node today. Browser globals are
reached only where they can be absent or supplied: `applyTheme` takes its root as a
parameter defaulting to `document.documentElement`, and `api.js` guards `indexedDB` and
`location`. Imported by both the dashboard and `server/`.

**Tier 2, the service.** All of `server/` and `scripts/`. Node only. May import tier 1.

**Tier 3, the dashboard.** `dist/ui/`, `dist/app.js`, `dist/boot.js`,
`dist/integrations.js`. Touches the DOM. May import tier 1.

The rule: **tier 1 never imports tier 2 or tier 3.** Tiers 2 and 3 never import each
other. `scripts/check.js` already walks every import specifier in `dist/`, so the tier
rule is a handful of lines there and it fails CI the first time somebody crosses it. That
check is the whole benefit a package boundary would have given, at none of the cost.

## The public API to add

Four additions, one per coupling the hosted site reported. Each is small, each gets a
test, and each stands on its own as a self-hosting feature.

### 1. HTML injection by marker, not by string search

Today the hosted site finds the charset meta, `</head>`, `</body>` and the title with
string and regex matches. Any of those breaks on an unrelated edit to `dist/index.html`.

Add comment markers to `dist/index.html` and `dist/integrations.html`:

```html
<!--awaker:head-start--> ... <!--awaker:head-end-->
... <!--awaker:body-end-->
```

Add `dist/site.js`, tier 1 and browser safe, exporting:

```js
injectHtml(html, {head = '', body = '', title, name}) -> string
```

It inserts `head` before `awaker:head-end`, inserts `body` before `awaker:body-end`,
replaces the `<title>` contents when `title` is given, and replaces every occurrence of the
app name when `name` is given. It throws a named error if a marker is missing, so a
breaking change to the HTML fails the hosted build loudly instead of silently producing a
page with nothing injected.

The app name is a separate concern worth doing properly rather than by substitution. The
dashboard hard-codes `awaker／` in two places in `dist/ui/render.js` plus the sidebar
brand. Read it from the site config in step 4 and default to `Awaker`.

A test asserts that both shipped HTML files contain all three markers, so the markers
cannot be dropped by accident.

### 2. A callable players-file generator and one copy of the freshness rule

Today the hosted build spawns `node scripts/slim-players.js`, imports `SLIM_MINIMUM` from
the browser module `dist/api.js`, and hard-codes both the `players.json` name and the 24
hour rule.

The 24 hour rule is currently written three times: `dist/api.js` as `24*HOUR` inside
`slimPlayerFile`, `server/http.js` as `PLAYERS_FRESH`, and a comment in
`scripts/slim-players.js`. Three copies of one number that must agree, in a repository that
otherwise never does this.

Export from `dist/api.js`, which already owns `SLIM_PLAYERS` and `SLIM_MINIMUM`:

```js
export const SLIM_PLAYERS = 'players.json', SLIM_MINIMUM = 500, SLIM_MAX_AGE = 24 * HOUR
```

Then `server/http.js` imports `SLIM_MAX_AGE` instead of defining `PLAYERS_FRESH`, and
`slimPlayerFile` uses the same constant. One number, one place, and a test that asserts the
route and the browser agree.

Export from `scripts/slim-players.js`:

```js
buildPlayersFile({out = DEFAULT_OUT, from = null}) -> Promise<{path, count, generatedAt, bytes, gzipBytes}>
```

This is the existing `main` with the console output removed and `generatedAt` added to the
return. `main` becomes a thin wrapper that calls it and prints. No behaviour changes, and
the hosted build drops its subprocess.

### 3. A declared origin manifest for the CSP

Today the hosted site copies `sleepercdn.com`, `api.sleeper.app`, `site.api.espn.com` and
`ntfy.sh` into its own CSP by hand, and they go stale silently.

Add `dist/origins.js`, tier 1:

```js
export const requiredOrigins = {
  img:     ['https://sleepercdn.com'],
  connect: ['https://api.sleeper.app', 'https://site.api.espn.com'],
  service: ['https://ntfy.sh']   // reached by the Node service, not the browser
}
```

`server/static.js` builds its `img-src` and `connect-src` from it instead of literals, so
the served CSP and the manifest cannot disagree. A test asserts that the manifest is
exactly these origins, and a second test greps the tier 1 sources for `https://` literals
and fails on any origin not in the manifest. That test is also the enforcement point for
the no-third-party rule below.

The hosted site then generates its CSP from the manifest, and an upstream change to a data
provider shows up as a diff in one file.

### 4. Static mode, a dist manifest, and a site config

Three related gaps. The hosted site currently rewrites `/api/v1/settings` to a null
response because `dist/app.js` probes it on every load, and relies on the resulting
`TypeError` being caught. It also ships `integrations.html`, which is service only and does
nothing on a static host.

**Static mode.** Read a boot flag so the dashboard never probes an API that is not there:

```html
<meta name="awaker:mode" content="static">
```

`dist/boot.js` reads it into `S.staticMode`, and `dist/app.js` skips the
`/api/v1/settings` probe, the 120 second unread poll and the `/integrations.html`
redirects when it is set. This also removes a wasted request with a 15 second timeout from
every static page load, and removes the only place where correct behaviour depends on an
exception being thrown.

Worth noting for self-hosters as well: a static host that answers unknown paths with
`200` and an HTML body makes that probe return `ok` and then fail on `response.json()`.
The current code survives that only because the `catch` is empty.

**A dist manifest.** Add a generated `dist/manifest.json` listing the files each mode
needs, so the hosted build can copy the static set rather than filtering by hand:

```json
{"shared": ["index.html", "app.js", "boot.js", "styles.css", "..."],
 "service": ["integrations.html", "integrations.js"]}
```

Generate it in `scripts/` and have a test assert it matches what is actually in `dist/`, so
a new file cannot be forgotten.

**A site config.** Add an optional `dist/site.json`:

```json
{"name": "Awaker", "links": [{"label": "About", "href": "/about"}]}
```

`dist/boot.js` loads it if present, the brand and page titles use `name`, and
`dist/ui/render.js` renders `links` in the existing status footer beside the Sleeper and
ESPN credits. Absent file means today's defaults, so self-hosters see no change unless they
write one.

**Scope limit, deliberate and enforced.** `site.json` carries a name and a list of label
and href pairs. No script hooks, no third-party origins, no identifiers, no analytics or
consent surface, in this file or anywhere else in awaker. The origin-manifest test in
step 3 is what keeps that true: an added third-party origin fails CI. Any hosted-site
need beyond a name and links stays in the hosted repository.

## Migration steps

Each step is shippable on its own, keeps the submodule working, and lets the hosted site
delete one hand-copied coupling. Rough agent time, excluding review.

1. **Write the tier rule down and enforce it in `scripts/check.js`.** Add the tier lists
   and a failing-import check. No behaviour change. About 20 minutes.
2. **Constants and the generator.** Add `SLIM_MAX_AGE`, point `server/http.js` and
   `slimPlayerFile` at it, extract `buildPlayersFile`. Tests for the shared constant and
   the new return shape. About 45 minutes.
3. **The origin manifest.** Add `dist/origins.js`, build the CSP from it, add both tests.
   About 45 minutes.
4. **Markers and `injectHtml`.** Add the three markers to both HTML files, add
   `dist/site.js`, add the marker-presence test. About 1 hour.
5. **Static mode, manifest and site config.** The boot flag, the `app.js` guards, the
   generated manifest with its test, and `site.json` with the brand and footer wiring.
   About 2 hours, the largest step because it touches the dashboard.

Total, roughly half a day of agent time plus review. After step 5 the hosted repository
holds only its own content: the site shell it injects, its CSP generation, its deploy
configuration and its brand. Nothing it copies by hand from here.

## What explicitly does not move

- **No new repository and no new package.** The submodule pin stays the integration point.
- **No `server/` code in the shared surface.** The hosted site is static and does not run
  the service. `requiredOrigins.service` is listed for completeness, not for the browser.
- **No hosted-only behaviour in public awaker.** If something only makes sense for a
  hosted deployment, it belongs in the hosted repository. The four additions above are in
  scope precisely because a self-hoster wants each of them.

# Contributing to Awaker

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md). For questions, see [getting help](SUPPORT.md).

Open an issue describing the problem before proposing a large feature. Include your Node version, hosting mode, relevant scoring rules, and reproduction steps. Use synthetic player and league data where possible. Never include tokens, `.env`, database files, private strategy, or full reports in an issue.

Use Node 24 LTS or Node 22.13 or newer. No package install is required. Run `npm run verify` before opening a pull request. Changes to serving or deployment should also pass `node scripts/container-smoke.js` with Docker available.

Keep lineup and valuation logic in pure shared modules so the browser, API, and background reports agree. Preserve explicit missing-data behavior. Avoid live-provider calls in tests and use fake notification transports.

The `dist/` directory contains editable source. Do not introduce a build system or runtime dependency without explaining the need.

## Where things live

- `dist/*.js` at the top level are the engines: scoring, lineups, trades, waivers, the season and league simulations, and the Sleeper and ESPN client. They are pure, and the browser, the service and the tests all share them.
- `dist/app.js` starts the dashboard: it checks for a service, reads preferences, then draws.
- `dist/ui/state.js` holds everything the dashboard remembers between redraws, in one object `S`. Add a field there, with a default, rather than keeping state in a module.
- `dist/ui/render.js` draws the whole page from `S`. `dist/ui/events.js` handles every click, change and input, and a handler changes `S` then calls `render()`.
- `dist/ui/pages/` has one module per page. A page function returns HTML, and every Sleeper-supplied string goes through `esc()`.
- `dist/ui/core.js` has the shared helpers and page chrome, `outlook.js` the rest-of-season projections, `odds.js` the background playoff odds, `session.js` connecting and refreshing, and `preferences.js` reading saved preferences.

To add a page, write its module in `dist/ui/pages/`, add it to `nav` in `core.js` and to `page()` in `render.js`, then add its title to `tests/ui.test.js`. That test draws every page from the demo data and checks that names from Sleeper are escaped. `npm run check` fails on a broken import path, or a named import that nothing exports. Keep persisted browser keys and legacy configuration compatible, or document a migration. Describe user-visible changes and meaningful verification in the pull request.

Python packaging uses Hatch with the version read from `package.json`. Build into `release/python` using `python -m build --outdir release/python`. Do not use the default build output directory because `dist/` contains application source. Install the built wheel, then run `python -m unittest discover -s tests/python -v`. Package tests must work outside the checkout and without system Node.

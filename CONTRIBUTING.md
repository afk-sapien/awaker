# Contributing to Awaker

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md). For questions, see [getting help](SUPPORT.md).

Open an issue describing the problem before proposing a large feature. Include your Node version, hosting mode, relevant scoring rules, and reproduction steps. Use synthetic player and league data where possible. Never include tokens, `.env`, database files, private strategy, or full reports in an issue.

Use Node 24 LTS or Node 22.13 or newer. No package install is required. Run `npm run verify` before opening a pull request. Changes to serving or deployment should also pass `node scripts/container-smoke.js` with Docker available.

Keep lineup and valuation logic in pure shared modules so the browser, API, and background reports agree. Preserve explicit missing-data behavior. Avoid live-provider calls in tests and use fake notification transports.

The `dist/` directory contains editable source. Do not introduce a build system or runtime dependency without explaining the need. Keep persisted browser keys and legacy configuration compatible, or document a migration. Describe user-visible changes and meaningful verification in the pull request.

Python packaging uses Hatch with the version read from `package.json`. Build into `release/python` using `python -m build --outdir release/python`. Do not use the default build output directory because `dist/` contains application source. Install the built wheel, then run `python -m unittest discover -s tests/python -v`. Package tests must work outside the checkout and without system Node.

# Releasing Awaker

The package version is currently 0.4.0. Container publishing is configured, but creating a tag, publishing a GitHub release, changing visibility, and publishing to PyPI remain separate actions.

## Try the container workflow

Open **Actions → Publish containers → Run workflow** and choose the default branch (`master`). The workflow verifies that branch, runs the full CI suite, and publishes:

- `ghcr.io/afk-sapien/awaker:edge`, the single application image.
- A `sha-<full-commit>` tag for the same image.

This makes a tested preview available without creating a release or moving `latest`. Packages remain private until their visibility is changed explicitly.

## Publish a version

1. Update `package.json`, the MCP server version in `server/mcp.js`, and `CHANGELOG.md`. The Python version is read from `package.json`.
2. Push the release commit to the default branch and confirm CI passes. Test the live-provider flows you intend to claim, including any owner-controlled ntfy delivery.
3. Stop and back up an existing service. Confirm an upgrade preserves its settings, reports, and database volume.
4. Create a tag matching the package version, such as `v0.2.0`, on the tested commit. For a preview, use a version such as `0.3.0-beta.1` and tag `v0.3.0-beta.1`.
5. Publish a GitHub release for that tag. Mark preview versions as a prerelease. Include changes, limits, migration notes, and launch commands.
6. Watch **Publish containers** finish, then verify the package and test a fresh pull.

The tag must match `package.json` and point to a commit reachable from the default branch. Draft releases do not publish images. Prereleases get their exact version tag. Stable releases get their exact version and `latest`. Manual runs get `edge` only.

## What publication checks

Publication calls the same CI workflow used for pull requests and branch pushes:

- Syntax and regression tests on Node 22 and 24.
- Source archive and wheel installation on Python 3.11/3.14, with Linux, macOS, and Windows coverage.
- Dashboard and service startup, authentication boundaries, unprivileged execution, and service persistence on native Linux AMD64 and ARM64 runners.
- Full-history Gitleaks scanning.
- Trivy scans of the image on both architectures. Any known HIGH or CRITICAL vulnerability blocks publication, even without an available fix. Full JSON reports include lower severities and are retained for 14 days.

The CI workflow also runs weekly to detect newly disclosed image vulnerabilities. A scanner or database-download failure fails the check. Remediate the base image or affected dependency and rerun. Do not silently bypass the gate.

Docker base images and third-party actions are pinned. Dependabot proposes updates weekly and keeps Node on the supported major version. Only publication jobs receive package-write permission. Pull requests cannot publish through this workflow. GHCR authentication uses the short-lived `GITHUB_TOKEN`, so no personal registry secret is required.

After pushing, each publication job pulls its exact image digest from GHCR and repeats the startup and service-persistence smoke tests. The image includes the MIT license, OCI source/revision labels, build provenance, and a software bill of materials. Inspect a published image with `docker buildx imagetools inspect ghcr.io/afk-sapien/awaker:edge`. Rerun a failed publication before announcing it.

## Before going public

- Review history, issues, branches, and release assets for personal data. Gitleaks detects credentials, not every kind of private information. Historical `.openai/hosting.json` contains a Sites project identifier, not a credential.
- Enable private vulnerability reporting and available GitHub secret protection features.
- Review the upstream [Sleeper API terms](https://docs.sleeper.com/) and retain external-data attribution. MIT covers Awaker's code, not provider data, photos, names, or trademarks.
- Change the repository visibility only when ready. Separately make the GHCR package public and confirm anonymous pulls work.
- Test installation from a fresh machine using the public URLs.

Synthetic tests and dependency scans do not prove there are no security issues. They also do not verify live data accuracy, every deployment configuration, or phone delivery.

## Python artifacts

Build with `python -m build --outdir release/python`, then install and test the wheel from outside the checkout. Use `release/python` because `dist/` contains app source. The wheel and source archive can be attached as GitHub release assets.

PyPI publishing is not configured. Continue documenting Git installation, a checkout, or a published wheel. Do not advertise bare `pip install awaker` until this project's package is actually published and verified there.

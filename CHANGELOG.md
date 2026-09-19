# Changelog

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

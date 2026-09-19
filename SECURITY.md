# Security

Awaker is a single-owner, read-only Sleeper companion. The optional service stores league strategy, account settings, and report history. It is not designed to host mutually untrusted users in one instance.

Use the latest maintained release, a supported Node LTS version, distinct random tokens, and HTTPS for remote access. Protect `.env`, the database, and backups. Keep the owner token out of MCP clients. Agent tokens can read analysis and trigger computation, but cannot change owner settings or submit Sleeper transactions.

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/afk-sapien/awaker/security/advisories/new) (**Security → Report a vulnerability**). Do not post exploit details or credentials in a public issue.

Only the latest release receives security fixes. No response-time guarantee is currently offered. Rotate exposed tokens immediately. Git-history scans reduce accidental exposure risk but do not establish that a release is free of vulnerabilities.

## Protections and verification

HTTP authentication uses separate owner and agent credentials, expiring HttpOnly sessions, same-origin checks, strict Host validation, and owner-only settings changes. JSON requests are limited to 64 KiB, API access is rate-limited, and at most four HTTP analysis or refresh calls can be in flight. MCP input is bounded before parsing. Provider responses have decoded-size limits and cannot redirect requests to another origin.

Containers run as a non-root user. The supplied Compose files use a read-only root filesystem, drop capabilities, and disable privilege escalation. Package-manager tooling is removed from runtime images. Pinned base images receive Dependabot updates.

CI and container publication scan full Git history for secrets and both image variants on AMD64 and ARM64 for known vulnerabilities. HIGH or CRITICAL image findings block publication. Weekly CI checks detect new advisories. Lower-severity findings remain visible in downloadable scan reports.

These controls reduce risk and are not a guarantee that the app is free of vulnerabilities. A compromised host, exposed owner token, or unsafe reverse proxy can bypass the intended single-owner boundary. Keep remote deployments behind HTTPS and protect backups.

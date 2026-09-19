# Security

Awaker is a single-owner, read-only Sleeper companion. The optional service stores league strategy, account settings, and report history. It is not designed to host mutually untrusted users in one instance.

Use the latest maintained release, a supported Node LTS version, distinct random tokens, and HTTPS for remote access. Protect `.env`, the database, and backups. Keep the owner token out of MCP clients. Agent tokens can read analysis and trigger computation, but cannot change owner settings or submit Sleeper transactions.

Report vulnerabilities privately through GitHub's **Security → Report a vulnerability** feature when enabled. If it is unavailable, open an issue asking the maintainer for a private reporting channel without describing the vulnerability or including sensitive data. Do not post exploit details or credentials in a public issue.

Only the latest release receives security fixes. No response-time guarantee is currently offered. Rotate exposed tokens immediately. Git-history scans reduce accidental exposure risk but do not establish that a release is free of vulnerabilities.

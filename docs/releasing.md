# Public release checklist

The current package version is 0.2.0. Prepare the first Awaker release as a prerelease, such as `v0.3.0-beta.1`, until enough real-league feedback supports a stable release. No tag, release, or visibility change is made by CI.

## Before publication

- Include the [MIT License](../LICENSE) in release archives. The source license does not grant rights to Sleeper, ESPN, NFL data, trademarks, or player photos.
- Rename the GitHub repository to `awaker`. This requires repository administrator access. Then update local remotes with `git remote set-url origin https://github.com/afk-sapien/awaker.git`.
- Review all Git history, issues, branches, and release assets for personal data. Gitleaks scans credentials, not every kind of private information. The original history contains a Sites project identifier in `.openai/hosting.json`, which is not a credential.
- Merge the reviewed release-preparation changes after CI passes.
- Require the Node 22 tests, Node 24 tests, container smoke tests, and secret scan on the default branch. Enable private vulnerability reporting and GitHub's available secret protection features.
- Review the upstream [Sleeper API terms](https://docs.sleeper.com/) and retain external-data attribution.
- Approve changing repository visibility to public only after this checklist is complete.

## Cut a release

1. Update `package.json`, the MCP server version, and `CHANGELOG.md` together.
2. Run `npm run verify` and `node scripts/container-smoke.js` on the exact commit to release. Confirm hosted CI is green too.
3. Verify a browser can connect a public Sleeper username, switch themes, run lineup/waiver/trade views, sign in to the service, and preview a report. Test ntfy separately with an owner-controlled topic if notifications are part of the release claim.
4. Stop and back up an existing service, then confirm the upgrade keeps preferences, reports, and the same Docker volume.
5. Tag the reviewed commit and create a GitHub prerelease. Include limitations, migration instructions, and launch commands in the release notes.
6. Test a fresh clone using the public URL. GitHub's source archive is sufficient because no build is required. Container registry publishing is optional and not configured in this release pass.

## Preparation evidence

Local validation results are recorded in the release-preparation pull request or handoff. Passing synthetic tests is not verification of live provider data, live phone delivery, or every host platform. Do not describe this pass as a comprehensive security audit.

# Self-hosting Awaker

## How it runs

There is one application and one image. Start it and you get the dashboard, which runs
in your browser and keeps its preferences there. Set `SLEEPER_USERNAME` and the same
process also runs the API and scheduled reports for that account, storing them in SQLite.

| Start it with | Dashboard | Add `SLEEPER_USERNAME` for reports |
| --- | --- | --- |
| Python | `awaker` | `awaker service --username NAME` |
| Node | `npm start` | `SLEEPER_USERNAME=NAME npm start` |
| Docker | `docker compose up -d` | Set it in `.env` or the Compose file |

The Node commands work on Windows, macOS, and Linux, and Node 24 LTS is recommended.
`compose.yaml` pulls the published image; add `-f compose.build.yaml` to build this
checkout instead. Use the exact URL printed at startup, because `localhost` and
`127.0.0.1` are distinct hosts and browser storage origins.

There is no login. Anyone who can reach the service can read its reports and change its
settings, including where notifications are sent, though the reported account cannot be
changed that way. To require a sign-in, set `AWAKER_ADMIN_TOKEN` and `AWAKER_AGENT_TOKEN`
in `.env`, restricted to your account (`chmod 600 .env`). Setting one without the other
is rejected. Generate them with `awaker setup`, or with Docker alone:

```sh
docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Prebuilt containers

The image is `ghcr.io/afk-sapien/awaker`, for Linux AMD64 and ARM64. It is public, so pulls need no GitHub account or registry login.

- `edge` follows successful manual publications from the default branch and is intended for previews.
- Version tags such as `0.3.0` are created when that matching GitHub release is published. Use a tag that actually appears in Packages.
- `latest` is created or updated only for a stable GitHub release. Prereleases never replace it.
- `sha-<full-commit>` identifies a publication's source commit. Pin `image@sha256:<digest>` when you need immutable deployment content.

Start it from a checkout, or with only `compose.yaml` copied out of it:

```sh
docker compose up -d
```

Add `SLEEPER_USERNAME` to `.env` or the Compose file for scheduled reports. Set `AWAKER_IMAGE`
to a published version or digest to pin a deployment. After backing it up, upgrade with:

```sh
docker compose pull
docker compose up -d
```

Browser preferences survive container replacement, and the service keeps its database in the
`sunday-data` volume. Do not run `down -v` unless you intend to delete that database. The volume
and service names are unchanged from earlier versions, so an existing deployment keeps its data.

### Upgrading from 0.2.0 (two containers to one)

0.2.0 shipped a dashboard image and a separate `awaker-service` image. There is now one image
that does both. Change the image to `ghcr.io/afk-sapien/awaker`, keep the same data volume
mounted at `/app/data`, keep your environment, add `SLEEPER_USERNAME` if the account was only ever entered in the
browser, and start it again. Settings, reports and alert
history carry over. Remove the old dashboard container if you ran both, since one container
now serves the dashboard and the service on port 4173. `compose.service.yaml` and the
`compose.ghcr*.yaml` files are replaced by `compose.yaml`.

## Python installation

Install from the checkout with `pipx install .`, or use `python -m pip install .` inside a virtual environment. Run `awaker` from any directory. The installed wheel includes the UI and service code. A separate Node installation is unnecessary. Python 3.11 or newer and a supported 64-bit platform are required. Runtime wheels cover Linux x86-64/ARM64, macOS x86-64/ARM64, and Windows x86-64/ARM64. See [runtime platform requirements](https://pypi.org/project/nodejs-wheel-binaries/) for OS minimums. Docker is an alternative for hosts without a compatible runtime wheel.

The Python CLI provides:

```sh
awaker                         # Dashboard, plus reports when SLEEPER_USERNAME is set
awaker --port 8080             # Use another local port
awaker service --username NAME # Dashboard, API, and scheduled reports for that account
awaker setup                  # Optional: generate owner and agent tokens
awaker mcp                    # Stdio MCP adapter for a running service
awaker --help
```

The user-data directory defaults to:

| Platform | Directory |
| --- | --- |
| Linux | `$XDG_DATA_HOME/awaker`, or `~/.local/share/awaker` |
| macOS | `~/Library/Application Support/Awaker` |
| Windows | `%LOCALAPPDATA%/Awaker` |

Override it with `AWAKER_HOME` or `--data-dir /path/to/awaker`. Use the same directory for setup and service. The directory contains `.env` and `awaker.sqlite`. Python setup restricts file permissions on POSIX systems. On Windows, keep the directory under your private user profile and use Windows access controls when sharing a machine.

`--env-file /path/to/.env` selects a different environment file. A Python install does not load a random `.env` from the current working directory. Existing process environment values override the chosen file, and explicit CLI flags override both. `--port` defaults the browser URL to that local port unless `--public-url`, the environment, or the env file already sets `AWAKER_PUBLIC_URL`. For `awaker mcp`, `--port` points the adapter at the service on that local port by setting `AWAKER_API_URL`. Use `--host 0.0.0.0 --public-url https://awaker.example.com` behind a properly configured reverse proxy.

To migrate an existing Node deployment, stop it, back up its database, and run `awaker service --env-file /absolute/path/to/old/.env` with `AWAKER_DB` set to the existing database's absolute path in that file. An omitted database override creates a separate Python-installation database.

Upgrade with `pipx upgrade awaker`, or reinstall the newer checkout/wheel using `python -m pip install --upgrade .`. For a same-version source reinstall, use `--force-reinstall`. User data stays outside the installed package and survives reinstalls. Uninstalling the package leaves user data in place. Back up that directory while the service is stopped.

For an agent's MCP configuration, use `awaker` as the command and `["mcp"]` as its arguments. Use an absolute executable path if the agent cannot find pipx commands on PATH. Set `AWAKER_API_URL` and `AWAKER_AGENT_TOKEN` in its environment. The owner token is unnecessary for MCP access, and `awaker mcp` removes it from the adapter's environment even when the env file contains it.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AWAKER_HOST` | `127.0.0.1` | Local bind address. Containers override this to `0.0.0.0` |
| `PORT` | `4173` | Local listening port. Compose fixes the container port to 4173 |
| `AWAKER_PUBLIC_URL` | `http://127.0.0.1:4173` | Exact browser origin, including a nonstandard port |
| `AWAKER_API_URL` | `http://127.0.0.1:4173` | Origin used by the MCP client |
| `AWAKER_ADMIN_TOKEN` | Empty | Owner access. Empty means no login at all |
| `AWAKER_AGENT_TOKEN` | Empty | Read-only analysis access for agents |
| `AWAKER_DB` | `data/awaker.sqlite` | SQLite path. Existing `data/sunday.sqlite` takes precedence when unset |
| `SLEEPER_USERNAME` | Required for the service | The account it reports on. Fixed at startup and not changeable through the browser or API |
| `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` | `https://ntfy.sh`, empty, empty | Optional defaults for phone pushes. Only the topic is required, and the token is for access-controlled topics. Notification settings saved in **Notifications** take over. `NTFY_URL` is also the only plain HTTP ntfy server the browser may choose |

Legacy `SUNDAY_*` names still work. A non-empty `AWAKER_*` value takes precedence. An empty value counts as unset, so a blank `AWAKER_ADMIN_TOKEN=` does not override a legacy `SUNDAY_ADMIN_TOKEN`. Tokens must be distinct and at least 32 printable ASCII characters. Generated tokens have 256 bits of randomness.

For local Node on another port, set `PORT`, `AWAKER_PUBLIC_URL`, and `AWAKER_API_URL` together. For Docker, change only the host side of the Compose port mapping and update both URLs. The container continues to listen on 4173.

## Remote access

Put a TLS reverse proxy in front of the service and set `AWAKER_PUBLIC_URL=https://awaker.example.com`. Configure the proxy to preserve the public Host header. Path-prefix hosting is not supported. Configure `AWAKER_API_URL` to the same HTTPS origin for a remote MCP client.

If the proxy runs on the same host, the default loopback port mapping is sufficient. For a proxy on another machine, bind the port to a private interface and restrict its firewall to that proxy. A proxy in a separate container must share a Docker network and forward to `awaker:4173`.

For nginx, configure the existing HTTPS virtual host to proxy `/` to `http://127.0.0.1:4173`, preserve `$http_host` as the upstream Host header, and allow a 180-second read timeout for analysis requests.

Configure certificates and HTTPS redirects in the proxy. The application does not terminate TLS. Its API limits requests by direct peer IP, so clients behind one proxy share the 120-request-per-minute budget. Forwarded IP headers are deliberately not trusted. The public UI is accessible without a login. Service account data and owner settings require authentication. This is a single-owner service, not a multi-user hosting platform.

`GET /healthz` checks service HTTP liveness and returns only `{"status":"ok"}`. It does not check provider freshness, schedule success, or notification delivery. The image includes a healthcheck. Inspect worker activity in **Notifications** for provider and delivery failures.

## Backups and upgrades

Run one service process per database. Preserve `.env` and the complete data directory or Docker volume. Stop the service before a filesystem backup so SQLite writes and notification updates have finished:

```sh
docker compose stop
```

Back up the mounted volume using your Docker host's backup tools, then restart with `docker compose start`. For Node deployments, stop the process and copy `data/`. Protect backups like the live data.

To upgrade, review release notes, back up state, pull the desired Git tag, and run:

```sh
docker compose up -d
```

Do not use `down -v` during upgrades. It deletes the data volume. Keep a pre-upgrade backup for rollback. Restore the matching backup if a later release introduces incompatible database changes. An ordinary restart preserves settings and report history, but ends browser sessions. To rotate a token, replace it in `.env` and recreate the service container or restart Node.

## Migrating from Sunday

Existing `SUNDAY_*` environment variables, browser preference/cache keys, and `data/sunday.sqlite` are supported. Browser keys retain their old internal names so no migration is needed on the same origin. Changing the browser origin does not transfer local preferences.

The Compose volume key remains `sunday-data`. Docker prefixes it with the Compose project name, which defaults to the checkout directory. If you rename an existing checkout from `sunday-fantasy-hq` to `awaker`, keep the original project name:

```sh
docker compose -p sunday-fantasy-hq up -d --remove-orphans
```

Use your actual previous project name if it differs. Stop the old stack first to avoid a port conflict. `--remove-orphans` removes the old `sunday` service container within that project. It preserves the named volume. Confirm the volume name with `docker volume ls` before migrating.

The static Docker image now listens on 4173 instead of nginx port 80. Custom `docker run` deployments must update their port mapping and set `AWAKER_PUBLIC_URL` to the browser origin. The WebMCP tool is now named `read_awaker_watchroom`. Reconnect browser agents that used the old name.

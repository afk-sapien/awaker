# Self-hosting Awaker

## Choose a mode

| Mode | Command | Storage | Credentials |
| --- | --- | --- | --- |
| Python dashboard | `awaker` | Browser only | None |
| Node dashboard | `npm start` | Browser only | None |
| Docker dashboard | `docker compose up -d --build` | Browser only | None |
| Python background service | `awaker setup`, then `awaker service` | User-data directory | Owner and agent tokens |
| Node background service | `npm run setup`, then `npm run service` | SQLite in `data/` | Owner and agent tokens |
| Docker background service | Setup `.env`, then `docker compose -f compose.service.yaml up -d --build` | Docker volume | Owner and agent tokens |

The Node launch commands work on Windows, macOS, and Linux. The source Compose files build locally. The `compose.ghcr*.yaml` files use prebuilt images from GitHub Container Registry. Node 24 LTS is recommended. Use the exact URL printed at startup. `localhost` and `127.0.0.1` are distinct hosts and browser storage origins.

If only Docker is installed, copy `.env.example` to `.env` and generate two tokens with this command, once per token:

```sh
docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `AWAKER_ADMIN_TOKEN` and `AWAKER_AGENT_TOKEN` in `.env`. Restrict file permissions to your account. On Linux and macOS, use `chmod 600 .env`.

## Prebuilt containers

The dashboard image is `ghcr.io/afk-sapien/awaker`. The background-service image is `ghcr.io/afk-sapien/awaker-service`. Both support Linux AMD64 and ARM64.

- `edge` follows successful manual publications from the default branch and is intended for previews.
- Version tags such as `0.2.0` are created when that matching GitHub release is published. Use a tag that actually appears in Packages.
- `latest` is created or updated only for a stable GitHub release. Prereleases never replace it.
- `sha-<full-commit>` identifies a publication's source commit. Pin `image@sha256:<digest>` when you need immutable deployment content.

Both packages are public, so pulls need no GitHub account or registry login. Repository visibility and package visibility are separate settings, so a private repository can still publish public images.

For dashboard mode, from the checkout:

```sh
docker compose -f compose.ghcr.yaml up -d
```

For service mode, create `.env` using the token instructions above, then:

```sh
docker compose -f compose.ghcr.service.yaml up -d
```

Choose one mode because both use the same local port. The GHCR Compose files preserve the existing service and volume names so source-build installations can switch without losing data. Keep the same Compose project name and directory when switching. Back up first.

Set `AWAKER_IMAGE` to a published version or digest to pin a deployment. Service mode requires the `awaker-service` image. After backing up the stopped service, upgrade with:

```sh
docker compose -f compose.ghcr.service.yaml pull
docker compose -f compose.ghcr.service.yaml up -d
```

Use `compose.ghcr.yaml` for the dashboard equivalent. Browser preferences survive container replacement. Do not run `down -v` unless you intend to delete the service database.

## Python installation

Install from the checkout with `pipx install .`, or use `python -m pip install .` inside a virtual environment. Run `awaker` from any directory. The installed wheel includes the UI and service code. A separate Node installation is unnecessary. Python 3.11 or newer and a supported 64-bit platform are required. Runtime wheels cover Linux x86-64/ARM64, macOS x86-64/ARM64, and Windows x86-64/ARM64. See [runtime platform requirements](https://pypi.org/project/nodejs-wheel-binaries/) for OS minimums. Docker is an alternative for hosts without a compatible runtime wheel.

The Python CLI provides:

```sh
awaker                         # Dashboard only
awaker --port 8080             # Dashboard on another local port
awaker setup                  # Generate private owner and agent tokens
awaker service                # Dashboard, API, and scheduled updates
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

`--env-file /path/to/.env` selects a different environment file. A Python install does not load a random `.env` from the current working directory. Existing process environment values override the chosen file, and explicit CLI flags override both. `--port` defaults the browser URL to that local port unless `--public-url` is also supplied. Use `--host 0.0.0.0 --public-url https://awaker.example.com` behind a properly configured reverse proxy.

To migrate an existing Node deployment, stop it, back up its database, and run `awaker service --env-file /absolute/path/to/old/.env` with `AWAKER_DB` set to the existing database's absolute path in that file. An omitted database override creates a separate Python-installation database.

Upgrade with `pipx upgrade awaker`, or reinstall the newer checkout/wheel using `python -m pip install --upgrade .`. For a same-version source reinstall, use `--force-reinstall`. User data stays outside the installed package and survives reinstalls. Uninstalling the package leaves user data in place. Back up that directory while the service is stopped.

For an agent's MCP configuration, use `awaker` as the command and `["mcp"]` as its arguments. Use an absolute executable path if the agent cannot find pipx commands on PATH. Set `AWAKER_API_URL` and `AWAKER_AGENT_TOKEN` in its environment. The owner token is unnecessary for MCP access.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AWAKER_HOST` | `127.0.0.1` | Local bind address. Containers override this to `0.0.0.0` |
| `PORT` | `4173` | Local listening port. Compose fixes the container port to 4173 |
| `AWAKER_PUBLIC_URL` | `http://127.0.0.1:4173` | Exact browser origin, including a nonstandard port |
| `AWAKER_API_URL` | `http://127.0.0.1:4173` | Origin used by the MCP client |
| `AWAKER_ADMIN_TOKEN` | Required for service | Owner access |
| `AWAKER_AGENT_TOKEN` | Required for service | Read-only analysis access |
| `AWAKER_DB` | `data/awaker.sqlite` | SQLite path. Existing `data/sunday.sqlite` takes precedence when unset |
| `SLEEPER_USERNAME` | Empty | Optional first-run account |
| `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` | Empty | All three are required to enable pushes |

Legacy `SUNDAY_*` names still work. An explicitly set `AWAKER_*` value takes precedence, including an empty value. Tokens must be distinct and at least 32 printable ASCII characters. Generated tokens have 256 bits of randomness.

For local Node on another port, set `PORT`, `AWAKER_PUBLIC_URL`, and `AWAKER_API_URL` together. For Docker, change only the host side of the Compose port mapping and update both URLs. The container continues to listen on 4173.

## Remote access

Put a TLS reverse proxy in front of the service and set `AWAKER_PUBLIC_URL=https://awaker.example.com`. Configure the proxy to preserve the public Host header. Path-prefix hosting is not supported. Configure `AWAKER_API_URL` to the same HTTPS origin for a remote MCP client.

If the proxy runs on the same host, the default loopback port mapping is sufficient. For a proxy on another machine, bind the port to a private interface and restrict its firewall to that proxy. A proxy in a separate container must share a Docker network and forward to `awaker:4173`.

For nginx, configure the existing HTTPS virtual host to proxy `/` to `http://127.0.0.1:4173`, preserve `$http_host` as the upstream Host header, and allow a 180-second read timeout for analysis requests.

Configure certificates and HTTPS redirects in the proxy. The application does not terminate TLS. Its API limits requests by direct peer IP, so clients behind one proxy share the 120-request-per-minute budget. Forwarded IP headers are deliberately not trusted. The public UI is accessible without a login. Service account data and owner settings require authentication. This is a single-owner service, not a multi-user hosting platform.

`GET /healthz` checks service HTTP liveness and returns only `{"status":"ok"}`. It does not check provider freshness, schedule success, or notification delivery. The service image includes a healthcheck. Inspect worker activity in **Agents & updates** for provider and delivery failures.

## Backups and upgrades

Run one service process per database. Preserve `.env` and the complete data directory or Docker volume. Stop the service before a filesystem backup so SQLite writes and notification updates have finished:

```sh
docker compose -f compose.service.yaml stop
```

Back up the mounted volume using your Docker host's backup tools, then restart with `docker compose -f compose.service.yaml start`. For Node deployments, stop the process and copy `data/`. Protect backups like the live data.

To upgrade, review release notes, back up state, pull the desired Git tag, and run:

```sh
docker compose -f compose.service.yaml up -d --build
```

Do not use `down -v` during upgrades. It deletes the data volume. Keep a pre-upgrade backup for rollback. Restore the matching backup if a later release introduces incompatible database changes. An ordinary restart preserves settings and report history, but ends browser sessions. To rotate a token, replace it in `.env` and recreate the service container or restart Node.

## Migrating from Sunday

Existing `SUNDAY_*` environment variables, browser preference/cache keys, and `data/sunday.sqlite` are supported. Browser keys retain their old internal names so no migration is needed on the same origin. Changing the browser origin does not transfer local preferences.

The Compose volume key remains `sunday-data`. Docker prefixes it with the Compose project name, which defaults to the checkout directory. If you rename an existing checkout from `sunday-fantasy-hq` to `awaker`, keep the original project name:

```sh
docker compose -p sunday-fantasy-hq -f compose.service.yaml up -d --build --remove-orphans
```

Use your actual previous project name if it differs. Stop the old stack first to avoid a port conflict. `--remove-orphans` removes the old `sunday` service container within that project. It preserves the named volume. Confirm the volume name with `docker volume ls` before migrating.

The static Docker image now listens on 4173 instead of nginx port 80. Custom `docker run` deployments must update their port mapping and set `AWAKER_PUBLIC_URL` to the browser origin. The WebMCP tool is now named `read_awaker_watchroom`. Reconnect browser agents that used the old name.

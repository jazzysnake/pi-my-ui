# Running pi-my-ui with Docker Compose

Two containers and one `.env`. `server` is the app; `caddy` terminates TLS on the tailnet and serves
the built client. Both use host networking, so the server still binds loopback and Caddy still binds
only the tailnet addresses. The [Caddy + private tailnet guide](caddy.md) is the network half; this is
the process half.

Nothing here runs as root and nothing here builds the app: the image carries `node` and the two tools
pi's Bash and grep reach for, and the repository is bind-mounted already built.

## What runs

```text
phone ──HTTPS──► Caddy (tailnet IPs, 443) ──┬── /              → packages/client/dist
                                            ├── /ws            → server 127.0.0.1:8787
                                            ├── /healthz       → server
                                            └── /files/download → server
```

| Service  | Image                         | Reaches                                             |
| -------- | ----------------------------- | --------------------------------------------------- |
| `server` | `deploy/Dockerfile` (built)    | `127.0.0.1:8787`, loopback only                     |
| `caddy`  | `caddy:2`                     | `443` on the two tailnet addresses, nothing else    |

`deploy/Caddyfile` and `deploy/compose.yaml` are committed; `deploy/.env` is not.

## The values

Copy the example and fill it in:

```bash
cd deploy
cp .env.example .env
$EDITOR .env
```

| Value                  | Means                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| `PI_MY_UI_UID` / `GID` | the user both containers run as; the owner of `~/.pi` and of the Projects     |
| `PI_MY_UI_HOME`        | that user's home directory                                                   |
| `PI_MY_UI_REPO`        | this repository, absolute                                                    |
| `PI_MY_UI_WORKSPACE`   | the tree your Projects live under, absolute                                  |
| `PI_MY_UI_TAILNET_NAME`| the MagicDNS name, which is also the `--allowed-origin` value                |
| `PI_MY_UI_TAILNET_IPV4`/`IPV6` | the two addresses Caddy binds                                       |
| `PI_MY_UI_PORT`        | the backend port, feeding both `--port` and Caddy's upstream                 |
| `PI_MY_UI_PROJECTS`    | the whole `--project` list, quoted, one flag per Project                     |

The three paths are mounted at **the same absolute path** inside the containers. That is not tidiness:
a Project is an absolute path, and pi finds a Session file through it, so a Project seen at
`/work/api` inside the container would be a different Project with no Sessions.

Compose reads `.env` from the directory you run it in, which is why the commands below `cd deploy`
first.

## Build and start

```bash
cd /home/<you>/<repo>
npm ci
npm run build          # server entry point, client bundle, bridge extension

cd deploy
docker compose up -d --build
docker compose ps      # server should reach "healthy"
```

`--build` matters the first time and whenever `deploy/Dockerfile` changes. It does **not** pick up
application code: that comes from the mounted repository, so after `npm run build` on the host,
`docker compose restart server` is enough.

## One Project more, one fewer

Edit `PI_MY_UI_PROJECTS` in `deploy/.env` and restart the server:

```bash
docker compose -f deploy/compose.yaml restart server   # from the repository root
```

The whole list is read at launch, so a restart is the moment it changes. A mount does not make
something a Project, and Projects may not nest or repeat: the launcher refuses both at startup and
names the path.

## Logs

```bash
docker compose logs -f server     # startup lines, refusals, Pi children
docker compose logs -f caddy      # TLS handshakes, proxy errors
```

The `pi-my-ui: project …` lines, the `listening on http://127.0.0.1:8787` line, one
`bridge: listening on …` line and a line per Pi child all land in the `server` log. That is the first
place to look when the page loads but never connects.

## `could not bind … the port is already in use`

The launcher exits rather than picking another port:

```text
pi-my-ui: could not bind "127.0.0.1":8787: the port is already in use; change --port (EADDRINUSE)
```

`restart: unless-stopped` turns that into a visible restart loop instead of a silently missing
server. Free the port, or change `PI_MY_UI_PORT` (Caddy's upstream follows the same value). If you
have a development server running, that is usually the holder:

```bash
ss -ltnp | grep 8787
```

## Upgrading, and what a restart costs

- **Pull and rebuild:** `git pull`, `npm ci`, `npm run build`, then
  `docker compose restart server caddy`. The image needs `--build` only when the Dockerfile changed.
- **Sessions are durable.** Each Session's file is the record; a stopped Session and a restarted one
  look the same when you open them, at the cost of a process start shown as **Starting…**.
- **A restart interrupts an in-flight turn.** Idle eviction never stops a running turn, but stopping
  the container stops every Pi child unconditionally. Wait until the Session shows no activity before
  restarting.

## The Caddy CA volume

`caddy-data` holds Caddy's local CA and its certificates. Deleting the volume mints a new root, and
every device has to trust it again — the phone shows a certificate warning until you do. Back the
volume up if you would rather not repeat the install:

```bash
docker run --rm -v pi-my-ui_caddy-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/caddy-data.tgz -C /data .
```

Extracting the root certificate for a device is in the [Caddy guide](caddy.md#5-trust-the-certificate-on-the-phone).

## User actions

1. **Once:** `npm ci && npm run build` in the repository, then `cd deploy && cp .env.example .env`
   and fill in every value.
2. **Once:** `docker compose up -d --build`, confirm `docker compose ps` shows the server healthy, and
   follow the [Caddy guide](caddy.md) to trust the CA and open the app on the phone.
3. **Enable Docker at boot** so the stack returns after a reboot:
   `sudo systemctl enable --now docker`.
4. **Per Project:** edit `PI_MY_UI_PROJECTS` and restart the server.

# Running Caddy with Docker Compose

One container and one `.env` that the server reads too. Compose runs **Caddy only**: it terminates
TLS on the tailnet and serves the built client, proxying three paths to the server, which runs from
node on the host ([server guide](server.md)). The [deploy overview](README.md) has the path diagram
and the start commands; the [Caddy + private tailnet guide](caddy.md) is the network half.

Host networking is what makes "reachable from the tailnet only" true: Caddy binds the tailnet
addresses rather than the wildcard interface, and its upstream is the loopback server.

`deploy/Caddyfile` and `deploy/compose.yaml` are committed; `deploy/.env` is not.

## The values

Copy the example and fill it in:

```bash
cd deploy
cp .env.example .env
$EDITOR .env
```

| Value                          | Means                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `PI_MY_UI_REPO`                | this repository, absolute; Caddy serves `packages/client/dist` from it |
| `PI_MY_UI_PORT`                | the backend port; the server's `--port` must carry the same value      |
| `PI_MY_UI_TAILNET_NAME`        | the MagicDNS name, which is also the `--allowed-origin` origin         |
| `PI_MY_UI_TAILNET_IPV4`/`IPV6` | the two addresses Caddy binds                                          |

`PI_MY_UI_PROJECTS` is in the same file but Caddy ignores it: the server reads it when you start it
([server guide](server.md#the-one-environment-file)).

Compose reads `.env` from the directory you run it in, which is why the commands below `cd deploy`
first.

## Start

```bash
cd /home/<you>/<repo>
npm ci
npm run build          # server entry point, client bundle, bridge extension

cd deploy
docker compose up -d
docker compose ps      # caddy should be "running"
```

There is nothing to `--build`: the image is upstream and the client bundle comes from the mounted
repository. After `npm run build`, Caddy serves the new bundle without a restart; only a `.env`
change needs `docker compose up -d` again.

The server does not need to be up first: Caddy answers `502` on the proxied paths until it is
listening. Starting the server is the [server guide](server.md#start-it).

## The server's port

Caddy proxies to `127.0.0.1:${PI_MY_UI_PORT}`. If the server binds a different port, every proxied
path answers `502` while the page still loads, so change the one value in `.env` and restart both
sides.

## Logs

```bash
docker compose logs -f caddy        # TLS handshakes, proxy errors
```

The server's own log is its terminal pane, not compose: the `pi-my-ui: project …` lines, the
`listening on http://127.0.0.1:8787` line, the `bridge: listening on …` line and a line per Pi child
are all in the [server's pane](server.md#logs-restarts-the-port). A `502` here means the server is not
running there.

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

See the [deploy overview](README.md#once). Caddy's half is `docker compose up -d` plus enabling
Docker at boot, and trusting the CA on each device ([Caddy guide](caddy.md#5-trust-the-certificate-on-the-phone)).

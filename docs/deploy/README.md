# Deployment

Two processes: the server runs from node on the host, Caddy runs in a container in front of it.
This page is the tldr; [the server](server.md), [Caddy and TLS](caddy.md) and
[compose](compose.md) are the detail.

```text
phone ──HTTPS──► Caddy (container, tailnet :443) ──┬── /               → packages/client/dist
                                                   ├── /ws             → server 127.0.0.1:8787
                                                   ├── /healthz        → server
                                                   └── /files/download → server
```

## Once

1. Node.js >= 22.22.2, npm, Docker with the compose plugin, and a tailnet with MagicDNS.
2. pi logged in as the user that runs the server: run `pi` in a terminal once.
3. `npm ci && npm run build` in the repository.
4. `cd deploy && cp .env.example .env`, then fill in every value: the repository path, the port, the
   MagicDNS name, its two tailnet addresses and the Project list. Caddy and the server read the same
   file.

## The three commands

```bash
# 1. the server; it reads deploy/.env
cd /home/you/pi-my-ui
set -a; . deploy/.env; set +a
node packages/server/dist/cli.js $PI_MY_UI_PROJECTS --port "$PI_MY_UI_PORT" --host 127.0.0.1 --allowed-origin "https://$PI_MY_UI_TAILNET_NAME"

# 2. Caddy, in front of it (second terminal)
cd /home/you/pi-my-ui/deploy && docker compose up -d

# 3. the server answers
curl -sS http://127.0.0.1:8787/healthz     # {"status":"ok","service":"pi-my-ui-server"}
```

Then open `https://<MagicDNS name>/?project=<absolute project path>` on the phone. The first device
needs Caddy's root certificate trusted once: [§5](caddy.md#5-trust-the-certificate-on-the-phone).

## Everyday

- **Logs:** the terminal the server runs in, and `docker compose logs -f caddy` for the proxy.
- **Restart the server:** `Ctrl-C`, then command 1. Nothing restarts it for you; after a reboot it is
  started again by hand.
- **One Project more or fewer:** edit `PI_MY_UI_PROJECTS`, restart the server. Caddy is unaffected.
- **After a `git pull`:** `npm ci && npm run build`, restart the server.

## Where the detail is

- [The server](server.md) — the environment file, the flags, logs, the port, upgrades, what a
  restart costs.
- [Caddy and TLS](caddy.md) — the phone address, the local CA, the origin allowlist and its
  refusals.
- [Compose](compose.md) — Caddy's container, the certificate volume, the proxy.
- [Troubleshooting](../troubleshooting.md) — what you see, why, what to do.

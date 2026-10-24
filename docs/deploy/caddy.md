# Caddy in front of a private tailnet

This is how the phone reaches `pi-my-ui` over a private [Tailscale](https://tailscale.com) or
[Headscale](https://headscale.net) tailnet with HTTPS: Caddy serves the built client at the machine's
MagicDNS name, terminates TLS with its own local CA, and reverse-proxies three paths to the server,
which stays on loopback.

```text
phone ──HTTPS──► Caddy (tailnet addresses :443) ──┬── /               → packages/client/dist
                                                  ├── /ws             → server 127.0.0.1:8787
                                                  ├── /healthz        → server
                                                  └── /files/download → server (POST)
```

The server itself serves no pages. Its whole HTTP surface is `GET /healthz`,
`POST /files/download` and the `/ws` upgrade; Caddy is what makes it an app you can open. The process
half — containers, mounts, restarts — is the [compose guide](compose.md).

## Why the certificate is a local CA

If your tailnet is coordinated by Tailscale's own service, Caddy recognises `*.ts.net` addresses and
fetches the certificate from `tailscaled`; that shortcut does not exist on a Headscale tailnet, whose
MagicDNS names are under your own domain. Headscale also cannot issue node certificates without an
ACME **DNS‑01** provider, so a private network whose DNS provider has no API has no path to a public
certificate at all. Caddy's local CA is the answer that needs neither.

The cost is one trust step per device: the phone installs Caddy's root certificate once (§5). The
reasoning, the rejected alternatives and what it forecloses are in
[ADR 0010](../adr/0010-https-on-a-private-tailnet-with-a-local-ca.md).

## 1. Prerequisites

1. **A tailnet** with MagicDNS enabled, and this machine signed in to it: `tailscale status` shows
   this machine and the phone. Nothing here depends on the tailnet's HTTPS-certificate feature, which
   a Headscale tailnet does not have.
2. **Docker** with the Compose plugin: `docker compose version`.
3. **pi credentials** under `~/.pi` for the user the containers run as. Run `pi` in a terminal once if
   you have not.
4. **The repository built at least once**: `npm ci && npm run build`. The client bundle in
   `packages/client/dist` and the server entry point `packages/server/dist/cli.js` are build output,
   not committed.

## 2. The name, and the origin that follows from it

One string drives everything: this machine's **MagicDNS name**, such as
`laptop.tailnet-name.ts.net` (Tailscale) or `laptop.tailnet.example.com` (Headscale). Both halves are
in the admin console, or:

```bash
tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"])'
```

The CLI's JSON format changes between releases, so the admin console is the stable source. Strip a
trailing dot if there is one: a fully qualified `Origin` never has one.

The **origin** is that name with a scheme, no path, on the default HTTPS port:

```text
https://laptop.tailnet-name.ts.net
```

That exact string is what the browser sends and what the server receives as `--allowed-origin` (the
compose file passes it for you). The server compares origins exactly, after URL normalisation:

- `https://` and `http://` are different origins.
- A non-default port is part of the origin: `https://host:8444` does not match `https://host`.
- A subdomain is a different host.
- A wildcard, a path, a query, a fragment or a `user@host` value is refused at startup with an error
  naming the flag.

Open the phone at **the name**, never the IP: the origin the browser sends comes from the URL you
typed.

## 3. Start the stack

```bash
cd deploy
cp .env.example .env      # then fill in the name, the two tailnet addresses, the paths, the Projects
docker compose up -d --build
```

The [compose guide](compose.md) explains every value. For this page, three of them matter:

- `PI_MY_UI_TAILNET_NAME` — the name from §2, which becomes the site address and the allowed origin.
- `PI_MY_UI_TAILNET_IPV4` / `IPV6` — from `tailscale ip -4` and `tailscale ip -6`, the addresses
  Caddy binds.
- `PI_MY_UI_PORT` — the backend port, used by both the server's `--port` and Caddy's upstream.

A healthy server logs one `pi-my-ui: project` line per served Project, then the listening line:

```text
pi-my-ui: project /home/you/projects/api
pi-my-ui: listening on http://127.0.0.1:8787
```

That address is for the machine only; the phone uses the Caddy name.

## 4. The Caddyfile

It is committed at `deploy/Caddyfile` and mounted into the container. It contains no machine values:
every deployment-specific string comes from the environment.

```caddyfile
{
	auto_https disable_redirects

	pki {
		ca local {
			intermediate_lifetime 720h
		}
	}
}

{$PI_MY_UI_TAILNET_NAME} {
	bind {$PI_MY_UI_TAILNET_IPV4} [{$PI_MY_UI_TAILNET_IPV6}]
	tls {
		issuer internal {
			lifetime 720h
		}
	}

	@pimyui path /ws /healthz /files/download
	reverse_proxy @pimyui 127.0.0.1:{$PI_MY_UI_PORT}

	root * {$PI_MY_UI_REPO}/packages/client/dist
	file_server
}
```

What each line buys:

- **`auto_https disable_redirects`** — no listener on `:80`. The phone uses `https://` only.
- **`bind`** — Caddy listens on the two tailnet addresses, not the wildcard interface, so the LAN
  cannot reach the site. Both address families are listed because MagicDNS answers AAAA and a
  v4-only bind silently drops a phone that prefers IPv6.
- **`tls` with the internal issuer** — Caddy mints certificates for the site address from its own CA.
  The 720h lifetimes are a wake-up story, not a trust one: a leaf cannot outlive the intermediate
  that signed it, and Caddy renews on a maintenance tick rather than the instant a suspended machine
  wakes. Its 12-hour leaf and 7-day intermediate defaults mean a laptop that slept past either serves
  an expired certificate until the next tick; lifetimes measured in weeks do not. The root — the one
  certificate a device trusts — is unchanged by either setting.
- **The `path` matcher** — `path` is exact, so only those three routes reach the server.
  Everything else falls through to `file_server`, which serves the client bundle and accepts only
  GET/HEAD; a missing `/files/download` would answer 404 or 405 instead of reaching the app.
- **`reverse_proxy`** — handles the WebSocket upgrade itself; no extra `websocket` directive is
  needed in Caddy 2.

If the phone cannot connect after a reboot with the tailnet address not yet up, Caddy exits at start
because the bind address does not exist. `restart: unless-stopped` retries it; no ordering hack is
needed.

## 5. Trust the certificate on the phone

The root certificate lives in the Caddy data volume:

```bash
cd deploy
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
tailscale file cp ./caddy-root.crt phone-name:        # Taildrop to the phone
```

On Android, the file arrives in the Tailscale app's **Files**: tap it, then **Install certificate**.
If the prompt does not appear, install it by hand from Settings → Security → Encryption & credentials
→ Install a certificate → **CA certificate** → Install anyway. Android requires a screen lock for
this. On iOS the equivalent is Settings → Profile Downloaded → Install, then Settings → General →
About → Certificate Trust Settings → enable full trust.

Chrome and Safari then accept `https://<name>` with no warning. Apps that bring their own trust store
are unaffected, which is fine: this certificate is for the browser.

The root is valid for ten years and is the only certificate a device trusts. Caddy renews the leaf
and the intermediate on its own: a leaf lasts up to 30 days and an intermediate 30 days, capped by
what the intermediate has left, because a new intermediate cannot extend one already signed.
Replacing the `caddy-data` volume mints a new root, and every device has to repeat this step.

## 6. Verify

On the laptop first, so a failure is not blamed on the phone:

```bash
cd deploy

# The server directly: must answer before Caddy is suspected of anything.
curl -sS http://127.0.0.1:8787/healthz
# → {"status":"ok","service":"pi-my-ui-server"}

# Through Caddy, trusting the CA file you extracted.
curl -sS --cacert ./caddy-root.crt -o /dev/null -w '%{http_code}\n' https://laptop.tailnet-name.ts.net/
# → 200   (the client HTML)
curl -sS --cacert ./caddy-root.crt https://laptop.tailnet-name.ts.net/healthz
# → {"status":"ok","service":"pi-my-ui-server"}

# The download route must reach the app, not file_server. With an allowlist configured, a request
# with no Origin is refused 403 by the app's own trust policy; 404 or 405 here means the matcher is
# missing /files/download.
curl -sS --cacert ./caddy-root.crt -o /dev/null -w '%{http_code}\n' -X POST \
  'https://laptop.tailnet-name.ts.net/files/download?project=nope&path=nope'
# → 403

# What the phone will see. Caddy's leaf names the host in a SAN, not in the subject, and stays well
# under the intermediate's life, which is what actually caps it. The root you installed on the phone
# is valid for ten years and does not change when either renews.
openssl s_client -connect laptop.tailnet-name.ts.net:443 \
  -servername laptop.tailnet-name.ts.net </dev/null 2>/dev/null |
  openssl x509 -noout -issuer -ext subjectAltName
# → issuer=CN = Caddy Local Authority - ECC Intermediate
#   X509v3 Subject Alternative Name: critical
#       DNS:laptop.tailnet-name.ts.net
```

On the phone:

1. Confirm the Tailscale app says **Connected**.
2. Open `https://laptop.tailnet-name.ts.net/?project=/home/you/projects/api`, optionally with
   `&session=<id>` (the [user guide](../guide.md#5-opening-a-session) explains where the id comes
   from).
3. The page loads, the certificate has no warning, and the connection dot reaches **Connected**.

If the page loads but the dot stays at **Connecting**, the reason is on the laptop's log, not in the
app. Continue with §7.

## 7. When the origin is wrong

The page loads and only the socket dies, so the app itself cannot tell you why. The server logs one
line per refusal, quoting the origin the browser actually sent:

```text
refused WebSocket upgrade: origin "https://laptop.old-name.ts.net" is not in the allowlist
```

That line is the diagnostic: it is what the browser sent, which can differ from anything you wrote
down. Compare it character by character with `PI_MY_UI_TAILNET_NAME`, and see the table in
[Troubleshooting](../troubleshooting.md#the-page-loads-but-never-connects).

A refusal leaks nothing back: the response is `HTTP/1.1 403 Forbidden` with no body. A missing
`Origin` is its own refusal when an allowlist is configured.

## 8. Project trust

A project's own `.pi` configuration — settings, MCP servers, extensions, skills, prompts, themes and
system-prompt files — needs pi's trust decision. RPC mode cannot show the trust prompt, so with no
saved decision pi skips those resources and the app behaves as if the project had no configuration.
This applies to each Session's Project, inside the container as on the host.

Decide once per project, outside the app: run `pi` in that folder in a terminal and save the decision
(`/trust`), or set `defaultProjectTrust` in `~/.pi/agent/settings.json`, or keep the configuration at
the user level. Context files such as `AGENTS.md` load regardless. The
[Troubleshooting entry](../troubleshooting.md#a-projects-pi-configuration-does-nothing-through-the-ui)
has the details.

## 9. User actions

Everything only you can do, in order. None of this is run by the repository's checks.

1. **On the phone:** install the Tailscale app and sign in to the same tailnet; confirm it says
   Connected.
2. **On the laptop:** `npm ci && npm run build`, then `cd deploy && cp .env.example .env` and fill in
   the tailnet name, both tailnet addresses, the paths and the Project list (§3).
3. **Start the stack:** `docker compose up -d --build`, and `sudo systemctl enable --now docker` so it
   returns after a reboot.
4. **Extract and install the CA:** §5, once per device.
5. **Open the Session address on the phone** and confirm the dot reaches **Connected**. If it does
   not, read `docker compose logs -f server` (§7).
6. **Per project directory:** record pi's project-trust decision before relying on that project's
   `.pi` configuration (§8).

## 10. What is checked and what you must confirm

The **server side** is covered by the repository's tests and launcher: the flags and their refusals,
the startup lines, the one-line port error, `GET /healthz`, the `404` for page paths, the WebSocket
upgrade with an allowed origin (`101`) and its refusal for a foreign origin, a wrong scheme, a
subdomain lookalike or a missing origin (`403`), and the download route's own trust and typed
refusals.

The **Caddy, Docker and tailnet side** — the local CA, `bind` to the tailnet addresses, the WebSocket
upgrade through the proxy, exact `path` matching, `file_server`'s 404/405 behaviour, the container
mounts, and the phone's acceptance of the CA — comes from those projects' documentation and has not
been run as part of this repository's checks. Bring it up on your machine with §9 and treat the first
run as a deployment step, not a test.

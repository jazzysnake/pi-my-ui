# Reaching pi-my-ui from the phone: Caddy + Tailscale

This is the deployment guide for running `pi-my-ui` on the laptop and opening it on the phone through
Caddy and Tailscale. You own the network layer; this document is the exact configuration and the
steps, and it says plainly which parts were run on a real machine and which you must confirm (§13).

**Written and verified against:**

- **Caddy 2.11.x** — the current release is `v2.11.7` (2026-10-03). Every Caddy behaviour quoted here
  is from the 2.11 documentation at `caddyserver.com/docs` (fetched 2026-10-12). Caddy is **not
  installed on the machine this guide was written on**, so no Caddy directive below was run here.
- **Tailscale 1.102.4** — the version installed on that machine. The CLI text quoted below is real
  output from that binary (`--help` only; your tailnet and account were not touched).
- **pi-my-ui** — the launcher flags, the bind/origin policy, the `/healthz` body and the WebSocket
  decisions quoted here were run against the built server (§13); the implementation record with the
  commands and their output is in the ticket folder:
  [E7-T2](../project/deployment-and-security/caddy-tailscale-deployment/ticket.md).

The security model behind all of this is [ADR 0013](../adr/0013-exposure-and-security.md): **no
authentication**, so reachability comes from Tailscale, the server binds loopback, and Caddy is the
only thing exposed. The application's own defence is the `Origin` allowlist on the WebSocket upgrade —
that is the one setting you can get wrong in a way that is both broken *and* insecure, so §5 and §8
give it more attention than the rest.

## 1. The arrangement

```text
phone (Tailscale app, signed in to the same tailnet)
  │   https://<machine>.<tailnet DNS name>
  ▼
Tailscale  ── resolves the name (MagicDNS) and carries the packet
  │
  ▼
Caddy on the laptop  ── terminates TLS; the only listener a browser can reach
  ├── serves the built client from  packages/client/dist
  └── proxies /ws, /healthz and /files/download  →  http://127.0.0.1:8787
                                        │
                                        ▼
                                  pi-my-ui server (loopback only)
                                        │   one `pi --mode rpc` child per session
                                        ▼
```

Two facts shape every line of the Caddyfile. Both were checked against the source and by running the
server on this machine:

1. **The `pi-my-ui` server does not serve the client bundle.** Its HTTP surface is exactly
   `GET /healthz`, `POST /files/download` (the file download/preview route, E6-T2) and the WebSocket
   route `/ws`; `GET /` and `GET /index.html` answer `404`. Serving the phone UI is therefore
   **Caddy's** job. (The mock server used for tests and e2e *does* serve the
   built client; the real launcher does not.)
2. **The socket URL comes from the page origin.** The client opens `new URL("/ws", location.href)` —
   an absolute path, and the assets are absolute too (`/assets/…`). The app must live at the **root**
   of the hostname; mounting it under a path prefix (`https://host/pi/`) cannot work without changing
   the client build.

One consequence worth stating before you start: with Caddy in front, you should **not** pass
`--host`. The default bind stays `127.0.0.1`, so the only way in is through Caddy — which is what
ADR 0013 asks for. (A non-loopback `--host` is refused at startup unless you also pass
`--allowed-origin`, and it would expose the port to the whole LAN; there is no reason to.)

## 2. Prerequisites

| # | What | How you know it is done |
|---|------|-------------------------|
| 1 | **Tailscale installed and signed in on the laptop** (`tailscale status` reports you are connected). | `tailscale status` on the laptop |
| 2 | **Tailscale installed and signed in on the phone**, same tailnet, connected. | the Tailscale app shows "Connected" |
| 3 | **MagicDNS enabled** for the tailnet, and **HTTPS certificates enabled**: admin console → **DNS** page → enable MagicDNS, then under **HTTPS Certificates** select **Enable HTTPS** and acknowledge that your machine names and tailnet DNS name are published on the public Certificate Transparency ledger. | `https://<fqdn>` resolves from the phone |
| 4 | **Caddy 2.11.x installed** on the laptop (distro package or the official install instructions — your choice; both give the same binary). | `caddy version` prints `v2.11.x` |
| 5 | **`pi` installed and authenticated** on the laptop, as the same user that will run `pi-my-ui`: `pi` finds its credentials under `~/.pi`. | `pi --version` works and a terminal `pi` session starts without asking you to log in |
| 6 | **The repository built at least once**: `npm ci && npm run build` from the repository root (the client bundle in `packages/client/dist` and `packages/server/dist/index.js` are build output, not committed). | `packages/client/dist/index.html` exists |

Prerequisite 3 is the one the Tailscale documentation attaches a warning to: enabling HTTPS
publishes the tailnet DNS name and this machine's name to a public ledger. If either contains
something you would rather not publish, rename the machine first. (Tailscale docs, "Enabling HTTPS",
fetched 2026-10-12.)

## 3. Find the hostname (which is also the allowed origin)

Everything downstream needs one string: the **MagicDNS name of the laptop**, e.g.

```text
laptop.tailnet-name.ts.net
```

The Tailscale docs state the shape: your tailnet has one **tailnet DNS name**, which already ends in
`.ts.net` — either a `tail<NNNN>.ts.net` form or a generated name such as `yak-bebop.ts.net` — and the
laptop's MagicDNS name is that name with the machine's name in front:
**`<machine name>.<tailnet DNS name>`**. So with the machine named `laptop` and the tailnet DNS name
`yak-bebop.ts.net`, the name is **`laptop.yak-bebop.ts.net`** — one `.ts.net`, never two.

Read it from the **admin console**: the **DNS** page shows the tailnet DNS name, and the **Machines**
page shows this machine's name. Concatenate them — the tailnet DNS name already carries its `.ts.net`
suffix, so you do not add another.

A scripted alternative is `tailscale status --json`, whose output has a `Self.DNSName` field — the
installed CLI's own help points at the JSON schema (`ipnstate.go` in the Tailscale repository) and
warns, verbatim:

```text
Warning: this format has changed between releases and might change more
in the future.
```

```bash
tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"])'
```

Two notes on the value you read:

- If it ends with a **dot** (a fully-qualified name), strip it. An `Origin` never has a trailing dot,
  and the browser never sends one; the server *accepts* the dotted value at startup, so the mistake
  surfaces later as every phone connection being refused (§8). The trailing dot is the DNS root, not
  part of the name.
- If you later rename the machine, the MagicDNS name changes with it and you must update both the
  Caddyfile and `--allowed-origin`.

**The origin** is that name with a scheme in front, on the default HTTPS port:

```text
https://laptop.tailnet-name.ts.net
```

That exact string is what you pass to `--allowed-origin`, and what the phone's browser sends. The
server compares it **exactly** after standard URL normalisation: `https://` and `http://` are
different origins; a non-default port is part of the origin (`https://host:8444` does **not** match
`https://host`); a subdomain is a different host (`https://evil-laptop.tailnet-name.ts.net` is not
`https://laptop.tailnet-name.ts.net`); and neither a wildcard (`*`) nor a value carrying a path, a
query, or credentials is accepted — each is refused at startup with an error naming the flag.

For the phone, **always open the name, never the IP address** — the origin the browser sends comes
from the URL you typed.

## 4. Start the server

From the repository root, with the project whose sessions you want on the phone:

```bash
npm exec --workspace @pi-my-ui/server -- pi-my-ui \
  --cwd "$HOME/projects/my-project" \
  --port 8787 \
  --allowed-origin "https://laptop.tailnet-name.ts.net"
```

- `--cwd` is the working directory whose sessions that server owns
  ([ADR 0003](../adr/0003-one-server-per-cwd.md): one server per project, the port is how you tell
  them apart). It defaults to the current directory.
- `--port` defaults to `8787`; it must match the `reverse_proxy` upstream in the Caddyfile.
- `--allowed-origin` is repeatable and is required for the phone UI to connect at all (§5).
- Leave `--host` alone: the default is `127.0.0.1`.

Other flags (`--idle-timeout`, default 300 s, and `--keep-alive`) are defined in
[ADR 0014](../adr/0014-idle-eviction-policy.md) and printed by `--help`; running the server
unattended as a service is [E7-T3's service guide](service.md), not this guide's.

Three invocations, run on this machine with the same `--help` output, but **not** interchangeable —
one of them depends on the repository root's `node_modules/.bin/pi-my-ui` link and two do not:

```bash
node packages/server/dist/index.js --help                  # the package's bin, run directly — no link needed
npm exec --workspace @pi-my-ui/server -- pi-my-ui --help    # via the workspace — no link needed
npx pi-my-ui --help                                         # needs the root node_modules/.bin link
```

`node packages/server/dist/index.js` runs the built entry point by path, and
`npm exec --workspace @pi-my-ui/server -- pi-my-ui` resolves the **workspace package's** `bin` through
the workspace — both work without the root link. Bare `npx pi-my-ui` is different: npm resolves the
command through the project's local bin directory, i.e. the repository root's
`node_modules/.bin/pi-my-ui` — a symlink to the built entry point that npm creates at install time.
That link is only created by an install (`npm ci` or `npm install`) once the built entry point exists,
so a fresh clone's `npm ci` runs before `npm run build` and leaves it absent — run `npm run build` and
then an install before bare `npx pi-my-ui` works. A **bare** `pi-my-ui` on your interactive `PATH` is
still not provided — `node_modules/.bin` is not on `PATH`. `npm link` or `npm install -g` inside
`packages/server` would give you one; that was not run here and is not required by this guide.

What a healthy start prints (real output, loopback bind):

```text
[pi-my-ui] cwd: /home/you/projects/my-project
[pi-my-ui] local: http://127.0.0.1:8787
```

The `local:` URL is for this machine only. From the phone you use the Caddy URL. Everything the
launcher warns about goes to **stderr**, which matters in §8.

## 5. The Caddyfile

Write this to a path you own (the examples use `/etc/caddy/Caddyfile`, the location a distro package
reads; `caddy run --config <path>` works with any path):

```caddyfile
# 1. The site address. This is a hostname, so Caddy activates automatic HTTPS for it.
#    Everything after this block's opening brace applies only to this name.
laptop.tailnet-name.ts.net {

	# 2. TLS. There is NO `tls` directive here, deliberately.
	#    Caddy 2.11 has a built-in special case: names ending in `.ts.net` are NOT
	#    managed by Caddy's ACME machinery. Instead Caddy asks the locally-running
	#    `tailscaled` for the certificate, at TLS-handshake time, and keeps using it.
	#    The certificate is therefore renewed by Tailscale, with no files and no
	#    renewal step. Prerequisites: HTTPS enabled for your tailnet (prerequisite 3)
	#    and the Caddy process either running as root or granted cert-fetch access (§6).
	#    If Caddy cannot reach tailscaled, the handshake fails and the phone reports a
	#    certificate/TLS error — see the troubleshooting table in §9.

	# 3. The routes the app owns: the WebSocket protocol route, the health check, and
	#    the file download/preview route (E6-T2). `path` matching is an exact match by
	#    default, and `/ws` is the single route the client opens
	#    (`new URL("/ws", location.href)`); `POST /files/download` is the one other
	#    HTTP route the app serves. A path that is **not** in this matcher is never
	#    reverse-proxied: it falls through to `file_server` below, which looks for a
	#    file at that URL under the client root, finds none, and answers `404` — the
	#    download never reaches the server. (Caddy 2.11's `file_server` also serves
	#    only `GET`/`HEAD` and answers `405` with `Allow: GET, HEAD` for any other
	#    method, so a `POST` to a path it *did* have on disk would also never reach
	#    the app.)
	@pimyui path /ws /healthz /files/download
	reverse_proxy @pimyui 127.0.0.1:8787

	# 4. The WebSocket upgrade itself needs no extra directive in Caddy v2: the
	#    documentation for `reverse_proxy` states that it "supports WebSocket
	#    connections, performing the HTTP upgrade request then transitioning the
	#    connection to a bidirectional tunnel". The v1 `websocket`/`transparent`
	#    shims are gone — adding one is a config error.

	# 5. The client bundle. The pi-my-ui server does not serve it (§1), so Caddy does.
	#    `root` sets the directory; `file_server` serves it. `root *` uses the
	#    wildcard matcher because the first argument is a path.
	root * /home/you/pi-my-ui/packages/client/dist
	file_server
}
```

Caddy sorts directives itself (its built-in order puts `reverse_proxy` before `file_server`), so the
textual order of 3/4/5 above does not decide which wins — the `@pimyui` path matcher does.

**Ports Caddy opens.** The site address has no port, so Caddy serves HTTPS on **443**; automatic HTTPS
also opens **80** and redirects to HTTPS. If you want Caddy reachable only over the tailnet, add
`bind <tailscale-ip>` (the address from `tailscale ip -4`) to the site block — the `bind` directive
takes interfaces, not ports. That hardening was not verified here; the default binds all interfaces,
and the origin allowlist still refuses a foreign browser either way.

**More than one project.** Because the client is rooted at `/` and opens `/ws` (§1), you cannot mount
a second project under a path prefix on the same hostname. Run it as a second site on its own port and
set that project's origin to include the port:

```caddyfile
laptop.tailnet-name.ts.net:8444 {
	@pimyui path /ws /healthz /files/download
	reverse_proxy @pimyui 127.0.0.1:8788

	root * /home/you/pi-my-ui/packages/client/dist
	file_server
}
```

...and start that server with `--port 8788 --allowed-origin "https://laptop.tailnet-name.ts.net:8444"`.
The port is part of the origin, so the two projects cannot share one `--allowed-origin` value.

### If Caddy cannot use the Tailscale certificate

`tailscaled` will only hand out a certificate to the Caddy user if it is told to. On a Linux package
install Caddy runs as its own unprivileged user (`caddy`), and Caddy's documentation gives two ways
out — **run Caddy as root**, or **grant that user access to fetch certificates**. The grant is the
`TS_PERMIT_CERT_UID` environment variable of `tailscaled`, set to the uid of the user allowed to fetch
certificates (Tailscale's own source describes it as "give your non-root webserver access (www-data,
caddy, nginx, etc) to certs"). On a systemd install that means an override such as
`/etc/systemd/system/tailscaled.service.d/cert.conf`:

```ini
[Service]
Environment=TS_PERMIT_CERT_UID=<uid of the caddy user>
```

then `sudo systemctl daemon-reload && sudo systemctl restart tailscaled`. **This was not run here** —
check `systemctl show -p User caddy` (or `id -u caddy`) for the uid on your machine, and see the
Tailscale documentation for your version. The variable is not mentioned on Tailscale's "Enabling
HTTPS" page (checked 2026-10-12); it is in the source
([`ipn/ipnserver/server.go`](https://github.com/tailscale/tailscale/blob/main/ipn/ipnserver/server.go),
`CanFetchCerts`) and in the note Caddy's own docs link to.

If you would rather not touch `tailscaled`, use a certificate from the CLI instead:

```bash
# One-time, as a user who may run tailscale (the docs say "with sudo as needed").
# The default output paths are DOMAIN.crt and DOMAIN.key.
sudo tailscale cert \
  --cert-file /etc/caddy/certs/laptop.tailnet-name.ts.net.crt \
  --key-file  /etc/caddy/certs/laptop.tailnet-name.ts.net.key \
  laptop.tailnet-name.ts.net
```

```caddyfile
laptop.tailnet-name.ts.net {
	tls /etc/caddy/certs/laptop.tailnet-name.ts.net.crt /etc/caddy/certs/laptop.tailnet-name.ts.net.key
	@pimyui path /ws /healthz /files/download
	reverse_proxy @pimyui 127.0.0.1:8787
	root * /home/you/pi-my-ui/packages/client/dist
	file_server
}
```

The `tls <cert_file> <key_file>` form is documented for Caddy 2.11 ("paths to the certificate and
private key PEM files; specifying just one is invalid"); loading a certificate this way also stops
Caddy from trying to obtain one for that name, which is what you want. The costs, both from the
Tailscale docs: the certificate expires after **90 days**, and — because the file path bypasses
Tailscale's own installation — **"you are responsible for renewing the certificate"**. Re-run
`tailscale cert` before it expires, make sure the Caddy user can read the key, and reload Caddy
(`sudo systemctl reload caddy`) afterwards; the 2.11 `tls` documentation describes the certificate
cache but does not promise that a rewritten file is picked up live.

Tailscale's documentation recommends the route that avoids all of that: "If a certificate is handled
without the user initiating any file-based certificate installation, such as when using the Caddy
integration of Tailscale, then the certificate will automatically be renewed without the user doing
anything." That is the default Caddyfile in this section.

A third option exists and needs no Caddy at all: `tailscale serve --bg 8787` exposes
`http://127.0.0.1:8787` as `https://laptop.tailnet-name.ts.net` with a Tailscale-managed certificate,
using the same CLI that is installed here. It is not part of this guide's Caddyfile and was not
verified; the `--allowed-origin` value would be unchanged.

## 6. Start Caddy

```bash
# Check the config before it is used; a syntax error here is much easier to read
# than a failed TLS handshake on the phone.
caddy validate --config /etc/caddy/Caddyfile

# Foreground, for the first run (Ctrl-C to stop):
sudo caddy run --config /etc/caddy/Caddyfile
```

Once it works, run it as a service. On a distro package install that is `sudo systemctl enable --now
caddy` with the same config path; the details of running the server unattended — service units on
systemd and launchd, logs, restart, ports for several projects — are in
[E7-T3's service guide](service.md). Not installed or configured here.

## 7. Verify end to end

**On the laptop first** (this exercises the tailnet path, not a loopback shortcut):

```bash
# The server, directly — must answer before Caddy is suspected of anything.
curl -sS http://127.0.0.1:8787/healthz
# → {"status":"ok","service":"pi-my-ui-server"}

# Through Caddy, over the tailnet name.
curl -sS -o /dev/null -w '%{http_code}\n' https://laptop.tailnet-name.ts.net/
# → 200   (the client HTML; Caddy serves it)
curl -sS https://laptop.tailnet-name.ts.net/healthz
# → {"status":"ok","service":"pi-my-ui-server"}   (proxied to the server)

# The download path must reach the app, not `file_server` (§5, step 3). A request with no
# Origin is refused 403 by the app's own trust policy; a 404 here instead means
# `/files/download` is missing from the `@pimyui` matcher and `file_server` answered it.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  'https://laptop.tailnet-name.ts.net/files/download?path=nope'
# → 403   (a 404 means the matcher is wrong — add /files/download to `@pimyui`)

# The TLS certificate the phone will see: the issuer is Let's Encrypt and the
# subject is your MagicDNS name.
openssl s_client -connect laptop.tailnet-name.ts.net:443 -servername laptop.tailnet-name.ts.net </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

**On the phone:**

1. Open the Tailscale app and confirm it says the phone is connected to your tailnet.
2. Open `https://laptop.tailnet-name.ts.net` in the browser. The page loads and the status line in the
   header goes **Connecting** → **Connected**. (Those are the literal labels the UI renders.)
3. If it sits at **Connecting**/**Reconnecting** and never reaches **Connected**, the app is not the
   place to look for the reason: the client deliberately has no error text for a failed socket, and
   reconnects with a bounded backoff. The reason is on the laptop's **stderr** — §8.

## 8. What "the origin is wrong" looks like

This is the failure to recognise, because the page loads and only the socket dies:

- **In the browser:** the app is served, the status line stays **Connecting**/**Reconnecting**, and no
  session list ever arrives. The browser console shows the WebSocket handshake failing with **403**.
- **On the laptop, on the launcher's stderr**, one line per refused attempt, quoting the origin the
  browser actually sent:

  ```text
  transport: refusing WebSocket upgrade from origin https://laptop.old-name.ts.net
  ```

  The value in that line is the one the **browser** sent, which is why it can differ from anything you
  wrote down — that is the whole diagnostic. Compare it character by character with `--allowed-origin`.
  A refused upgrade is logged as a security event, never silently dropped.

A refused upgrade does not leak anything back to the client: the response is a bare
`HTTP/1.1 403 Forbidden` with `Connection: close`, `Content-Length: 0`, and no body.

The common causes, in order:

| What the log line shows | Cause |
|---|---|
| `(missing)` | a non-browser client with no `Origin`. A configured allowlist rejects those by design. |
| `http://…` where you configured `https://…` | scheme mismatch — the origin includes the scheme. |
| the right host with a `:8444` (or missing) port | the port is part of the origin. A 443 site has no port in its origin; a site on 8444 does. |
| an older machine name | you renamed the machine; MagicDNS renamed it too. Update the Caddyfile and the flag. |
| an IP address or a different name | the phone was opened at something other than the MagicDNS name you configured. |
| a lookalike (`…ts.net.evil.example`, `evil-…ts.net`) | not a configuration mistake — that is the check working. |

A different refusal, for the record:

```text
transport: refusing WebSocket upgrade: Host "evil.example" is not an allowed host
```

That is the DNS-rebinding guard, which runs **before** the origin check: the request's `Host` must be
one of the configured origins' hostnames or a loopback host. Behind Caddy this should never fire,
because Caddy passes the incoming `Host` through to the backend unchanged (documented default
behaviour; only `X-Forwarded-For`/`-Proto`/`-Host` are added). If you see it, something rewrote `Host`.

## 9. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| The phone cannot reach the name at all (DNS failure) | Tailscale disconnected on one device, or MagicDNS disabled | Tailscale app on the phone; admin console → DNS page. `https://<fqdn>` cannot resolve without MagicDNS. |
| Connection refused / **502** from Caddy, page may still load | The server is not running, or Caddy proxies to the wrong port | `curl -sS http://127.0.0.1:8787/healthz`; compare `--port` with the `reverse_proxy` upstream. Caddy logs the upstream error. |
| Caddy will not start: `address already in use` | Something else already has 443/80 (another web server, or a second Caddy) | `ss -ltnp \| grep -E ':443\|:80'` |
| `pi-my-ui` exits at once with `could not bind "127.0.0.1":8787: the port is already in use; change --port (EADDRINUSE)` | Two servers, one port | pick another `--port` and update the Caddyfile |
| Certificate error on the phone (`NET::ERR_CERT_*`, "not valid for this name") | Caddy could not get a Tailscale certificate (§5), the name does not match the certificate's subject, or the certificate expired | `openssl s_client` from §7; `journalctl -u caddy` for the handshake error; the admin console's machine page shows the certificate status. |
| The socket closes right after connecting, or briefly during use | A Caddy **config reload** closes live WebSocket connections: Caddy "forcibly clos[es]" them and sends a Close control message. The client reconnects on its own | expected after `systemctl reload caddy`; nothing to fix unless it repeats on its own |
| Everything works from the laptop but not from the phone | the phone is on a different tailnet, or you opened the IP instead of the name | compare the origin in the stderr line (§8) with what you configured |

## 10. Project trust: what the phone UI will and will not ask you

`pi-my-ui` runs `pi --mode rpc` children. pi's installed documentation is explicit:

> Print, JSON, and RPC modes cannot show the built-in trust prompt.

So **there is no built-in "do you trust this folder?" dialog to approve from the phone.** When a
working directory contains trust-gated resources — `.pi/settings.json`, `.pi/mcp.json`,
`.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`,
or a project `.agents/skills` — pi needs a trust decision before it loads them, and in RPC mode it
resolves that decision without asking you:

1. a saved decision for that directory or an ancestor (closest one wins), from `~/.pi/agent/trust.json`;
2. otherwise the global `defaultProjectTrust` setting, whose default is `"ask"` — which, with no
   prompt available, means the protected resources are **skipped**.

The server passes no `--approve`/`--no-approve` override: a spawned child's arguments are exactly
`--mode rpc`, plus the session selector and the bridge extension (verified in the source). So a
project that relies on its own `.pi` configuration will behave differently through the UI than in a
terminal `pi`, with no error — the settings are simply not loaded.

**What to do**, per project directory you open through the UI:

- run `pi` once in a terminal in that directory and record the decision (`/trust` saves it for future
  processes), or
- set `defaultProjectTrust` in `~/.pi/agent/settings.json`, or
- keep the project's configuration at the user level instead of in `.pi/`.

It applies to the **session's working directory** — for this deployment, the directory you passed to
`--cwd` (ADR 0003: one server per project directory). Context files such as `AGENTS.md` load
regardless; trust gates the executable and configuration resources, not the prompt.

**The in-app wording of any dialog is not reproduced here, because it does not exist yet.** This
ticket's definition of done asked for the trust-prompt wording from E7-T2's dependency E2-T7
([ticket](../project/pi-integration-core/extension-ui-bridge/ticket.md)), but E2-T7 is still `to do`:
the repository contains no `project_trust` handler and no dialog component, so there is no wording to
quote. Everything above is pi's own documented behaviour, quoted from the copy of pi installed here.
When E2-T7 lands, the dialog text and this section must be brought together (the board's user-actions
lane has a row for approving trust).

## 11. User actions

Everything only you can do, in order. Nothing here was installed, enabled, or started for you.

1. **Tailscale:** install and sign in on the phone if you have not; on the laptop confirm
   `tailscale status` reports a connection. Enable MagicDNS and **Enable HTTPS** on the admin console's
   DNS page, accepting that your names are published on the public Certificate Transparency ledger.
2. **Install Caddy 2.11.x** on the laptop and confirm `caddy version`.
3. **Grant the Caddy user access to the Tailscale certificate** — either run Caddy as root, or set
   `TS_PERMIT_CERT_UID` for `tailscaled` (§5). Alternatively run `tailscale cert` once and switch the
   Caddyfile to the file-based `tls` form, accepting a manual 90-day renewal.
4. **Write the Caddyfile** from §5 with your MagicDNS name, the client directory, and the port; run
   `caddy validate --config <path>` and then `caddy run` (or enable the service).
5. **Start the server** with `--cwd`, `--port` and `--allowed-origin https://<your MagicDNS name>`
   (§4) — see E7-T3 for running it as a service.
6. **Open `https://<your MagicDNS name>` on the phone** and confirm the header reaches **Connected**.
   If it does not, read the laptop's stderr (§8).
7. **Per project directory:** record pi's project-trust decision before relying on that project's
   `.pi` configuration in the UI (§10).

## 12. Secrets and placeholders

The Caddyfile holds no secret in the recommended form: the private key stays inside `tailscaled` and
Caddy fetches the certificate over the local socket. In the file-based form the key is a real secret —
keep it readable only by the Caddy user and never in the repository. The `--allowed-origin` value and
the MagicDNS name are placeholders in this document (`laptop.tailnet-name.ts.net`); replace them with
your own, and do not commit them anywhere they do not belong. No token, key, or machine-specific path
is recorded here.

## 13. What was verified here, and what you must confirm

**Run on this machine** (the commands and their exact output are in the ticket's implementation
record; the server was started on loopback only):

- the launcher's flags, defaults, help text, and its refusals (a non-loopback bind with no allowed
  origin; a wildcard, a credential-bearing, a path-bearing, and an unparseable `--allowed-origin`;
  an out-of-range `--port`), including the exact wording of each error;
- the startup lines and their exit codes;
- `GET /healthz` → `{"status":"ok","service":"pi-my-ui-server"}`; `GET /` and `GET /index.html` →
  `404`; `GET /ws` with an allowed origin → `101`, with a foreign origin, a wrong scheme, a subdomain
  lookalike, a missing origin, or a foreign `Host` → `403`;
- the download route (`POST /files/download`) in process, through the app's own HTTP handler rather
  than through Caddy: its origin/host trust coverage (a foreign origin, a missing origin, a spoofed
  `Host` → `403`) and its typed refusals (a directory, a missing file, a permission failure → their
  own statuses) are asserted by `packages/server/test/transport/download-route.test.ts` (E6-T2). The
  route being reachable *through Caddy* is the matcher amendment in §5, which is **not** run here;
- the child's argument list (no `--approve`) and the client's socket URL, both read from the source;
- Tailscale's 1.102.4 CLI help text quoted in §3 (offline `--help`; your tailnet was not read).

**Quoted from documentation, not run here** — you must confirm each on your own machine:

- every Caddy directive and behaviour in §5 and §6 (Caddy is not installed here): the `.ts.net`
  certificate special case, `reverse_proxy`'s WebSocket upgrade handling and `Host` pass-through,
  exact `path` matching, `bind`, `tls <cert> <key>`, and `caddy validate`/`run`;
- what `file_server` does with a request the `@pimyui` matcher did **not** catch (the reason the
  download path must be in the matcher): fetched from Caddy 2.11.7's source
  (`modules/caddyhttp/fileserver/staticfiles.go`), a missing file is answered `404` and any method
  other than `GET`/`HEAD` is answered `405` with `Allow: GET, HEAD`. The source was read, not the
  running binary;
- the Tailscale HTTPS enablement steps, the MagicDNS name's shape, the 90-day certificate lifetime and
  the renewal responsibility (Tailscale's docs, fetched 2026-10-12), and `ts.net` behaviour;
- `TS_PERMIT_CERT_UID` (Tailscale's source and a comment Caddy's docs link to; the variable is not in
  Tailscale's main documentation pages);
- the `Self.DNSName` JSON field (the CLI's own help warns the format changes between releases).

**Not verified at all, and not verifiable here:** the whole phone-side path — Tailscale connectivity
on the phone, MagicDNS resolution, the certificate the phone accepts, and the UI reaching
**Connected**. Those are the E8-T1 on-device acceptance steps.

# Caddy + Tailscale: reaching the app from your phone

This guide puts `pi-my-ui` on your phone over a private Tailscale network. Caddy serves the built
client at a MagicDNS HTTPS name and reverse-proxies three paths to the server, which stays bound to
loopback.

```text
phone ──HTTPS──► Caddy (443) ──┬── /            → packages/client/dist
                               └── /ws          → server 127.0.0.1:8787 (WebSocket)
                                   /healthz     → server
                                   /files/download → server (POST)
```

The server itself serves no pages. Its whole HTTP surface is `GET /healthz`,
`POST /files/download` and the `/ws` upgrade. Caddy is what makes it a web app you can open.

## 1. Prerequisites

1. **Tailscale** signed in on the laptop and the phone, both on the same tailnet.
2. **MagicDNS and HTTPS enabled** for the tailnet in the Tailscale admin console (DNS page).
   Enabling HTTPS publishes the tailnet name and machine name on the public Certificate Transparency
   ledger. Rename the machine first if either contains something you would rather not publish.
3. **Caddy 2** installed. These instructions were written against 2.11; check `caddy version`.
4. **pi credentials** under `~/.pi` for the user that runs the server. Run `pi` in a terminal once
   to log in if you have not; the server uses the pinned pi package from this repository.
5. **The repository built at least once**: `npm ci && npm run build`. The client bundle in
   `packages/client/dist` and the server entry point `packages/server/dist/cli.js` are build output,
   not committed.

## 2. Find the hostname (which is also the allowed origin)

You need one string: the laptop's **MagicDNS name**, for example `laptop.tailnet-name.ts.net`. The
tailnet has one DNS name ending in `.ts.net`; the machine's name goes in front, and there is exactly
one `.ts.net` suffix.

The admin console shows both halves: the **DNS** page has the tailnet DNS name, and the **Machines**
page has this machine's name. The CLI can also print it:

```bash
tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"])'
```

The CLI's own help warns that the JSON format changes between releases, so the admin console is the
stable source.

- If the value ends with a **dot** (a fully qualified name), strip it. An `Origin` never has a trailing
  dot, and the browser never sends one.
- Renaming the machine changes the MagicDNS name; update both the Caddyfile and `--allowed-origin`.

The **origin** is that name with a scheme and no path, on the default HTTPS port:

```text
https://laptop.tailnet-name.ts.net
```

That exact string is what the browser sends and what you pass to `--allowed-origin` (repeat the flag
for more origins). The server compares origins exactly after URL normalisation:

- `https://` and `http://` are different origins.
- A non-default port is part of the origin: `https://host:8444` does not match `https://host`.
- A subdomain is a different host.
- A wildcard, a path, a query, a fragment or a `user@host` value is refused at startup with an error
  naming the flag.

Open the phone at **the name**, never the IP: the origin the browser sends comes from the URL you
typed.

## 3. Start the server

From the repository root, with the project whose Sessions you want on the phone:

```bash
node packages/server/dist/cli.js \
  --cwd "$HOME/projects/my-project" \
  --port 8787 \
  --allowed-origin "https://laptop.tailnet-name.ts.net"
```

- `--cwd` is the working directory whose Sessions and files this server owns. One server serves one
  project; the port is how you tell servers apart. It defaults to the current directory.
- `--port` defaults to `8787`; it must match the `reverse_proxy` upstream in the Caddyfile.
- `--allowed-origin` is repeatable and is required for the phone UI to connect. Without it, only a
  loopback browser is accepted.
- Leave `--host` alone. The default is `127.0.0.1`, so only the local Caddy can reach the server.
- `--idle-timeout` (default 120 seconds) and `--keep-alive` control when an unwatched Session's Pi
  child is stopped; running this unattended is the [service guide](service.md)'s subject.

A healthy start prints:

```text
pi-my-ui: cwd /home/you/projects/my-project
pi-my-ui: listening on http://127.0.0.1:8787
```

A `bridge: listening on …` line goes to stderr and is expected. The `listening on` URL is for this
machine only; the phone uses the Caddy name. Warnings and refusals go to stderr, which matters in
[§7](#7-when-the-origin-is-wrong).

## 4. The Caddyfile

Write this where your Caddy reads it (a distro package usually reads `/etc/caddy/Caddyfile`; use any
path with `caddy run --config <path>`):

```caddyfile
# The site address is a hostname, so Caddy activates automatic HTTPS for it.
laptop.tailnet-name.ts.net {

	# No `tls` directive here, deliberately. Caddy special-cases names ending in `.ts.net`:
	# instead of ACME it asks the local tailscaled for the certificate during the TLS
	# handshake, and Tailscale renews it. This requires HTTPS enabled for the tailnet and the
	# Caddy process being allowed to fetch the certificate (§4.1). If Caddy cannot reach
	# tailscaled, the handshake fails and the phone reports a certificate error.

	# Route only the paths the app owns to the server. `path` matching is exact by default.
	# /ws is the single WebSocket the client opens; /healthz is the up-check; /files/download
	# is the POST the browser uses for downloads and exports. Anything not matched here falls
	# through to file_server, which serves files from the client bundle and accepts only
	# GET/HEAD — so a missing /files/download is answered 404 or 405, never proxied.
	@pimyui path /ws /healthz /files/download
	reverse_proxy @pimyui 127.0.0.1:8787

	# reverse_proxy handles the WebSocket upgrade itself: it performs the HTTP upgrade and
	# then tunnels the connection. No extra websocket directive is needed in Caddy 2.

	# The client bundle. The pi-my-ui server does not serve it.
	root * /home/you/pi-my-ui/packages/client/dist
	file_server
}
```

Caddy sorts directives itself, so the textual order does not decide which wins; the `@pimyui` matcher
does.

**Ports.** The site address has no port, so Caddy serves HTTPS on 443 and also opens 80 to redirect.
To keep Caddy reachable only over the tailnet, add `bind <tailscale-ip>` (from `tailscale ip -4`) to
the site block. That hardening is optional; the origin allowlist refuses a foreign browser either way.

### 4.1 If Caddy cannot use the Tailscale certificate

`tailscaled` hands out certificates only to a user it permits. A Linux package install runs Caddy as
the unprivileged `caddy` user. Two ways out:

- **Run Caddy as root**, or
- **grant the Caddy user access** by setting `TS_PERMIT_CERT_UID` on `tailscaled` to that user's uid.
  On a systemd install, an override such as `/etc/systemd/system/tailscaled.service.d/cert.conf`:

  ```ini
  [Service]
  Environment=TS_PERMIT_CERT_UID=<uid of the caddy user>
  ```

  then `sudo systemctl daemon-reload && sudo systemctl restart tailscaled`. Check the uid with
  `id -u caddy`.

If you prefer not to touch `tailscaled`, use a certificate from the CLI:

```bash
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

`tls <cert_file> <key_file>` also stops Caddy from trying to obtain a certificate for that name. The
cost: the certificate expires after 90 days and you are responsible for renewing it with
`tailscale cert` and reloading Caddy. Keep the key readable only by the Caddy user, and never commit
it.

### 4.2 More than one project

The client is rooted at `/` and opens `/ws`, so a second project needs its own site on its own port,
not a path prefix:

```caddyfile
laptop.tailnet-name.ts.net:8444 {
	@pimyui path /ws /healthz /files/download
	reverse_proxy @pimyui 127.0.0.1:8788

	root * /home/you/pi-my-ui/packages/client/dist
	file_server
}
```

Start that server with `--port 8788 --allowed-origin "https://laptop.tailnet-name.ts.net:8444"`. The
port is part of the origin, so the two projects cannot share one `--allowed-origin` value.

## 5. Start Caddy

```bash
caddy validate --config /etc/caddy/Caddyfile   # catch syntax errors before the phone does
sudo caddy run --config /etc/caddy/Caddyfile   # foreground, first run
```

Once it works, run it as a service: `sudo systemctl enable --now caddy` with the same config path.
The laptop-side service for pi-my-ui itself is the [service guide](service.md).

## 6. Verify

On the laptop first, so a failure is not blamed on the phone:

```bash
# The server directly: must answer before Caddy is suspected of anything.
curl -sS http://127.0.0.1:8787/healthz
# → {"status":"ok","service":"pi-my-ui-server"}

# Through Caddy, over the tailnet name.
curl -sS -o /dev/null -w '%{http_code}\n' https://laptop.tailnet-name.ts.net/
# → 200   (the client HTML, served by Caddy)
curl -sS https://laptop.tailnet-name.ts.net/healthz
# → {"status":"ok","service":"pi-my-ui-server"}   (proxied to the server)

# The download path must reach the app, not file_server. With an allowlist configured, a
# request with no Origin is refused 403 by the app's own trust policy; a 404 or 405 here
# instead means /files/download is missing from the matcher.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  'https://laptop.tailnet-name.ts.net/files/download?path=nope'
# → 403

# The certificate the phone will see.
openssl s_client -connect laptop.tailnet-name.ts.net:443 \
  -servername laptop.tailnet-name.ts.net </dev/null 2>/dev/null |
  openssl x509 -noout -subject -issuer -dates
```

On the phone:

1. Confirm the Tailscale app says Connected.
2. Open the Session address: `https://laptop.tailnet-name.ts.net/?session=<id>` (the
   [user guide](guide.md#5-opening-a-session) explains where the id comes from).
3. The page loads and the connection dot reaches **Connected**.

If it stays at **Connecting** or **Reconnecting**, the reason is on the laptop's stderr, not in the
app. Continue with §7.

## 7. When the origin is wrong

The page loads and only the socket dies, so the app itself cannot tell you why. The server logs one
line per refusal, quoting the origin the browser actually sent:

```text
refused WebSocket upgrade: origin "https://laptop.old-name.ts.net" is not in the allowlist
```

The value in that line is the diagnostic: it is what the browser sent, which can differ from anything
you wrote down. Compare it character by character with `--allowed-origin`, and see the table in
[Troubleshooting](troubleshooting.md#the-page-loads-but-never-connects).

A refusal leaks nothing back: the response is `HTTP/1.1 403 Forbidden` with no body. A missing
`Origin` is its own refusal when an allowlist is configured:

```text
refused WebSocket upgrade: the request carried no Origin and an allowlist is configured
```

## 8. Project trust

A project's own `.pi` configuration — settings, MCP servers, extensions, skills, prompts, themes and
system-prompt files — needs pi's trust decision. RPC mode cannot show the trust prompt, so with no
saved decision pi skips those resources and the app behaves as if the project had no configuration.
This applies to each Session's working directory.

Decide once per project, outside the app: run `pi` in that folder in a terminal and save the decision
(`/trust`), or set `defaultProjectTrust` in `~/.pi/agent/settings.json`, or keep the configuration at
the user level. Context files such as `AGENTS.md` load regardless. The
[Troubleshooting entry](troubleshooting.md#a-projects-pi-configuration-does-nothing-through-the-ui)
has the details.

## 9. User actions

Everything only you can do, in order. None of this is run by the repository's checks.

1. **Tailscale:** install and sign in on the phone; on the laptop confirm `tailscale status` reports
   a connection. Enable MagicDNS and HTTPS in the admin console (DNS page), accepting that names are
   published on the public certificate ledger.
2. **Install Caddy 2** and confirm `caddy version`.
3. **Grant Caddy access to the Tailscale certificate** — run Caddy as root, set `TS_PERMIT_CERT_UID`
   for `tailscaled`, or install a file certificate and accept the 90-day renewal (§4.1).
4. **Write the Caddyfile** from §4 with your MagicDNS name, client directory and port; run
   `caddy validate`, then `caddy run` (or enable the Caddy service).
5. **Start the server** with `--cwd`, `--port` and
   `--allowed-origin https://<your MagicDNS name>` (§3). Use the [service guide](service.md) to keep it
   running.
6. **Open the Session address on the phone** and confirm the dot reaches **Connected**. If it does
   not, read the laptop's stderr (§7).
7. **Per project directory:** record pi's project-trust decision before relying on that project's
   `.pi` configuration (§8).

## 10. What is checked and what you must confirm

The **server side** is covered by the repository's tests and launcher: the flags and their refusals,
the startup lines, the one-line port error, `GET /healthz`, the `404` for page paths, the WebSocket
upgrade with an allowed origin (`101`) and its refusal for a foreign origin, a wrong scheme, a
subdomain lookalike or a missing origin (`403`), and the download route's own trust and typed
refusals.

The **Caddy and Tailscale side** — the `.ts.net` certificate special case, the WebSocket upgrade,
`Host` pass-through, exact `path` matching, `file_server`'s 404/405 behaviour, and the phone's
certificate acceptance — comes from those projects' documentation and has not been run as part of
this repository's checks. Bring it up on your machine with §9 and treat the first run as a
deployment step, not a test.

# Troubleshooting

Every entry follows the same shape: **what you see**, **why**, **what to do**. Commands assume you
are in the repository folder on the laptop.

## The page loads but never connects

**You see:** the page is served, the connection dot stays **Connecting** or **Reconnecting**, no
transcript arrives, and — when an origin was refused — the browser console shows the WebSocket
handshake failing with 403.

**Why:** one of two things. The address has no `?session=<id>`, so the page has no Session to open; or
the server refused the browser's `Origin` because it is not the one you configured.

**What to do:** first check the address. It must name a Session, for example
`https://laptop.tailnet-name.ts.net/?session=<id>` (see
[Opening a Session](guide.md#5-opening-a-session)). Then read the server's terminal. A refusal is one
line per attempt, quoting the origin the browser actually sent:

```text
refused WebSocket upgrade: origin "https://laptop.old-name.ts.net" is not in the allowlist
```

Compare that value character for character with `--allowed-origin`. The common mismatches:

| The log line shows                            | What is wrong                                                    |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `origin "http://…"` where you configured https | the origin includes the scheme; `http` and `https` differ        |
| a `:8444` port, or no port where there is one  | a non-default port is part of the origin                          |
| an older machine name                         | the machine was renamed and MagicDNS followed; update both values |
| an IP address or a different name             | the phone was opened at something other than the allowed name      |
| `the request carried no Origin`               | a non-browser client, or a proxy that strips the header            |
| `origin "…" is not loopback`                  | no allowlist is configured, so only loopback origins are accepted  |

A refused upgrade returns a bare `403` with no body, so the browser cannot tell you more than that.

## The dot flips to Reconnecting, then recovers

**You see:** the dot turns amber and reads **Reconnecting**, then returns to **Connected** by itself.

**Why:** the socket was dropped — the network changed, the laptop slept, or Caddy reloaded its config,
which closes live WebSocket connections. The client retries with a growing delay, capped at 15
seconds, and catches up from where it was: missed output is replayed, or a fresh Snapshot is sent if
the gap is too old to replay. Runs continue on the server whether or not your browser is connected.

**What to do:** nothing. If it repeats on its own, look at the Caddy log and the server's stderr for a
proxy or process restart.

## Caddy answers 502, or the app talks to the wrong port

**You see:** a **502** from Caddy, or a page that loads while the connection never arrives.

**Why:** the server is not running, or Caddy proxies to a port no server is listening on.

**What to do:** check the server directly: `curl -sS http://127.0.0.1:<port>/healthz` must answer
`{"status":"ok","service":"pi-my-ui-server"}`. Then make sure the Caddyfile's `reverse_proxy` target
matches the server's `--port`. The [Caddy + Tailscale guide](deploy/caddy.md) has the route matcher
and the check commands.

## `could not bind … the port is already in use`

**You see:** the launcher exits at once with:

```text
pi-my-ui: could not bind "127.0.0.1":8787: the port is already in use; change --port (EADDRINUSE)
```

**Why:** another server (a second project, or another app) already has that port.

**What to do:** start this server on a different `--port`, and update the Caddy `reverse_proxy`
upstream to match. Find the holder on Linux with `ss -ltn`; on macOS with
`lsof -nP -iTCP -sTCP:LISTEN`. The [service guide](deploy/service.md) covers the same failure under a
service manager.

## `refusing to bind to 0.0.0.0`

**You see:**

```text
pi-my-ui: refusing to bind to 0.0.0.0: binding beyond loopback requires at least one --allowed-origin
```

**Why:** you passed a `--host` beyond loopback without an origin allowlist. The server refuses rather
than exposing an app that has no authentication.

**What to do:** keep `--host 127.0.0.1` and let Caddy be the only reachable surface, or add the origin
the browser will use, for example
`--allowed-origin https://laptop.tailnet-name.ts.net`.

## `--allowed-origin` is refused at startup

**You see:** the launcher exits with one of these and prints the help text:

```text
pi-my-ui: --allowed-origin may not be a wildcard; list each origin explicitly
pi-my-ui: --allowed-origin must be a bare origin without a path, query, fragment, or credentials, e.g. https://pi.example.ts.net, got "https://x.example/foo"
pi-my-ui: --allowed-origin may not contain credentials (user@host): the credential is discarded and a different host would be allowed, got "https://u@x.example"
```

**Why:** the flag takes one bare origin (`scheme://host[:port]`). A wildcard, a path, a query, a
fragment or a `user@host` value is refused instead of being silently normalised into a wider rule.

**What to do:** pass the exact origin the browser sends, and repeat the flag for more origins.

## A Session sits at Starting…

**You see:** the run-state row reads **Starting…** for about a second.

**Why:** this is **expected**, not an error. The Session's Pi child had been stopped — either by idle
eviction after `--idle-timeout` seconds (120 by default) or by a server restart — and is being started
again from its Session file. The transcript is preserved.

**What to do:** wait a moment. To stop idle eviction entirely, start the server with `--keep-alive`.
The cost of keeping every child is measured in [Measurements](measurements.md).

## A Session shows "Pi child exited"

**You see:** the run-state row reads **Pi child exited**, with `exit code <n>` or `signal <name>`, and
offers **Reconnect**.

**Why:** the `pi` process for that one Session exited unexpectedly. The Session **file** is intact, so
no completed turn is lost.

**What to do:** tap **Reconnect**. The server starts a fresh `pi` from the Session file and the
transcript returns. If it keeps happening, read the server's stderr: pi writes its own failure there,
and an out-of-memory kill or a missing credential looks different from a crash inside a tool call.

## pi is not authenticated on the laptop

**You see:** a Session's turn fails with an authentication error from pi, or the child exits soon after
a prompt.

**Why:** the `pi` package the server launches has no working credentials for the user that runs the
server.

**What to do:** run `pi` in a terminal **as the same user that runs pi-my-ui** and complete its login
(install pi globally if the command is not available; the credentials are shared) and then tap
**Reconnect** on the Session.

## A project's `.pi` configuration does nothing through the UI

**You see:** no dialog, and the app behaves as if the project's `.pi` settings, MCP servers,
extensions, skills, prompts, themes or `SYSTEM.md` were not there.

**Why:** pi asks for project trust before loading a folder's `.pi` resources, and that prompt cannot
be shown in RPC mode, which is how the server runs pi. With no saved decision, pi skips the protected
resources. Context files such as `AGENTS.md` still load.

**What to do:** make the trust decision outside this app, per project directory: run `pi` once in that
folder in a terminal and save the decision (`/trust`), or set `defaultProjectTrust` in
`~/.pi/agent/settings.json`, or keep the configuration at the user level under `~/.pi`. There is no
in-app trust dialog.

## The bridge fails to load or connect

**You see:** the composer's error line carries a bridge error, and the server's stderr carries the
same line. One of:

```text
the bridge extension is not built at /…/packages/bridge-extension/dist/index.js; run npm run build
session "…": the bridge for session "…" did not connect within 10000ms
bridge socket "/run/user/1000/pi-my-ui-8787/bridge.sock": another process is already listening here; refusing to replace it
```

**Why:** the bridge is required. It is loaded into every Pi child and is the server's only channel
past pi's RPC. There is no degraded mode that runs without it: a Session whose child never completes
the handshake cannot be served, and a second server cannot share the socket of a live one.

**What to do:** run `npm run build` after any pull, make sure only one server is bound to that port,
and restart the server so a stale socket is cleaned up. If pi itself refused to load an extension,
the reason is in pi's own stderr, which the server forwards.

## The agent pill and agent list are missing

**You see:** a Session works normally but there is no agent pill in the top bar.

**Why:** the Session's pi has not reported any agents. The usual cause is that the
`@tintinweb/pi-subagents` extension is not installed for pi. The server does not install it, and it
does not show a half-working subagent surface.

**What to do:** install it in pi with `pi install npm:@tintinweb/pi-subagents`, then start a new
Session (or resume one) so the extension loads. When a Session reports an agent, the pill appears.

## A download fails through the proxy

**You see:** tapping a file or **Download** does nothing, or Caddy answers 404/405.

**Why:** downloads are `POST /files/download`. Caddy only reverse-proxies the paths in its matcher; a
path it does not match falls through to `file_server`, which does not accept that method. The Vite dev
server does not proxy the download route at all.

**What to do:** add `/files/download` to the Caddy matcher exactly as the
[Caddy + Tailscale guide](deploy/caddy.md) shows, then reload Caddy. For development, use the Caddy
setup when you need downloads.

## The composer shows an error and keeps my message

**You see:** a red line under the composer, and your text and images are still there.

**Why:** pi refused the message, or the link dropped while it was being sent. The composer clears only
once pi's echo of your message appears in the transcript, so a refusal cannot look like a send.

**What to do:** read the line. A malformed message is refused by the server's validator, a message
pi will not accept names its own reason, and a dropped link disables sending until the dot is
Connected again. Retry once the reason is addressed; the draft is intact.

## A slash command is refused

**You see:** `/settings is a pi TUI-only command and is not available in pi-my-ui`.

**Why:** that command exists only in pi's terminal interface. Forwarding it as prompt text would send
a literal `/settings` to the model, so the app refuses it instead.

**What to do:** use a supported command from the [list](guide.md#10-slash-commands-and-the-palette), or
type the request in plain words. Any other `/` text is sent to the agent as written.

## A long Session shows fewer messages than it has

**You see:** at the top of the transcript, **N older messages are not shown**.

**Why:** the transcript mounts only its newest 60 entries to keep a very long Session fast on a phone.
The whole Session is still in its file and in the Pi child; only the rendered window is bounded.

**What to do:** search or read the Session in pi for older content; `/session` still reports the full
counts and `/export` writes the whole conversation as HTML.

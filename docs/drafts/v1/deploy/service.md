# Running `pi-my-ui` as a service

Keep one `pi-my-ui` server per project running across SSH logins and reboots. On Linux this is a
**systemd user unit**; on macOS it is a **launchd LaunchAgent**. Both run the same launcher with the
same flags and the same restart-on-failure behaviour.

The launcher binds **loopback only** by default ([ADR 0013](../adr/0013-exposure-and-security.md));
[Caddy + Tailscale](#user-actions) is what the phone actually reaches. This guide is the
service/launch half; the proxy half is the Caddy + Tailscale guide (E7-T2, `docs/deploy/caddy.md`).

## Placeholders used below

| Placeholder | Means | Example |
|---|---|---|
| `/home/<you>` | your home directory | `/home/ana` |
| `/Users/<you>` | your home directory on macOS | `/Users/ana` |
| `<repo>` | where you cloned `pi-my-ui` | `pi-my-ui` |
| `<project>` | the project whose sessions this server owns | `webapp` |
| `<port>` | a TCP port unique **on this machine** | `8787` |
| `<tailnet>` | your Tailscale tailnet name | `example` |

Set the real values in the files below; nothing in this repository hard-codes a machine path.

## Prerequisites

1. **Node.js ≥ 22.22.2** (`engines.node` in the repository's root `package.json`). The service runs the
   **built** launcher, so the build must exist and be current:
   ```bash
   cd /home/<you>/<repo>
   npm ci
   npm run build          # produces packages/server/dist/index.js
   ```
   Rebuild after every `git pull`.
2. **`pi` on the service's `PATH`.** The session pool spawns `pi` by name (`PI_EXECUTABLE = "pi"` in
   `packages/server/src/rpc/rpc-process.ts`), resolved through `PATH`. A service manager starts with a
   minimal `PATH`, so the unit sets it explicitly (see below) — otherwise sessions fail to spawn even
   though `/healthz` is green.
3. **Caddy + Tailscale**, per the Caddy + Tailscale guide (E7-T2), including the allowed-origin value
   that matches the Tailscale HTTPS name.
4. **A user service, not root.** Nothing here needs root: the server binds an unprivileged port on
   loopback. Do **not** run it as a system-wide/root service.

## The launch command

The launcher's executable (`pi-my-ui`) is a workspace package's `bin` (`packages/server/package.json`),
and npm links it into the repository root's `node_modules/.bin` — the root package does not have to
depend on the workspace. npm only creates that link when the `bin` target already exists, so the order
above matters: a fresh clone's `npm ci` runs **before** the build and its install leaves no link; run
`npm install` once the build exists (or re-run `npm ci`) and it appears. Observed on this machine
(npm 12.0.2):

```
$ ls -l node_modules/.bin/pi-my-ui
lrwxrwxrwx … node_modules/.bin/pi-my-ui -> ../@pi-my-ui/server/dist/index.js
$ ./node_modules/.bin/pi-my-ui --help     # prints the usage below, exit 0
```

Run the built entry point directly under the service manager: it is a **stable absolute path** and
produces no npm wrapper output, both of which matter when a manager, not a shell, starts the process:

```bash
node /home/<you>/<repo>/packages/server/dist/index.js --help
```

A **bare** `pi-my-ui` is still not usable — but not because npm declined to link it: `node_modules/.bin`
is not on a shell's `PATH`, so nothing resolves the name outside an npm-run context (`command -v pi-my-ui`
exits 1). Two other forms work from the repository root, but neither is what the unit should run:
`./node_modules/.bin/pi-my-ui …` is relative to the repository root, and
`npm exec --workspace @pi-my-ui/server -- pi-my-ui …` prints two `npm notice run …` lines to stderr first.

The flags (this is `--help`'s real output at the current revision):

| Flag | Meaning | Default |
|---|---|---|
| `--cwd <dir>` | Working directory the server is scoped to; its sessions are the only sessions it serves | the process's current directory |
| `--port <port>` | TCP port to listen on | `8787` |
| `--host <address>` | Address to bind | `127.0.0.1` |
| `--idle-timeout <seconds>` | Evict an idle, unwatched session's child after this long ([ADR 0014](../adr/0014-idle-eviction-policy.md)) | `300` |
| `--keep-alive` | Disable idle eviction entirely | off |
| `--allowed-origin <origin>` | Browser origin allowed to connect; **repeatable**. Required when binding beyond loopback | none |
| `-h`, `--help` | Print usage and exit | — |

On start it prints one line per fact:

```
[pi-my-ui] cwd: /home/<you>/projects/<project>
[pi-my-ui] local: http://127.0.0.1:8787
```

A bind beyond loopback additionally prints a `[pi-my-ui] phone:` line per non-loopback IPv4 address.
These lines are the startup record; keep them (systemd journal, or the launchd log files below).

### The invocation both units use

```bash
node /home/<you>/<repo>/packages/server/dist/index.js \
  --cwd /home/<you>/projects/<project> \
  --host 127.0.0.1 \
  --port <port> \
  --allowed-origin https://pi.<tailnet>.ts.net
```

- `--host 127.0.0.1` is the default, written out so the security intent is visible: only the local Caddy
  can reach the server.
- `--allowed-origin https://pi.<tailnet>.ts.net` is required so the page the phone loads — served from
  the Tailscale name behind Caddy — may open the WebSocket. It must be a **bare origin**
  (`scheme://host[:port]`), exactly matching what the browser sends. A value with a path, query,
  fragment, credentials, or `*` is rejected at startup with a typed error naming the flag (verified
  below).
- Add `--keep-alive` only if you want sessions never evicted while idle ([ADR 0014](../adr/0014-idle-eviction-policy.md));
  it does **not** make a restart non-destructive (see [Restart vs. running sessions](#restart-vs-running-sessions)).

## Linux — a systemd user unit

A systemd unit's **name is its filename stem**, so the file and every `systemctl`/`journalctl`
command below share one spelling: `pi-my-ui.<project>` (with `<project>` = `webapp`, the file is
`pi-my-ui.webapp.service` and the command is `systemctl --user … pi-my-ui.webapp`). The dot inside the
stem is legal, and the `<project>` substitution is what gives each project its own unit. The launchd
`Label` in the next section uses the identical stem.

Create `~/.config/systemd/user/pi-my-ui.<project>.service`:

```ini
[Unit]
Description=pi-my-ui server for <project> (/home/<you>/projects/<project>)

[Service]
Type=simple
WorkingDirectory=/home/<you>/<repo>
Environment=PATH=/home/<you>/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /home/<you>/<repo>/packages/server/dist/index.js --cwd /home/<you>/projects/<project> --host 127.0.0.1 --port <port> --allowed-origin https://pi.<tailnet>.ts.net
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Line by line:

| Line | Why it is there |
|---|---|
| `[Unit]` / `Description=` | An identifier that shows up in `systemctl --user status` and the journal. |
| `[Service]` | Marks the process-supervision section. |
| `Type=simple` | The launcher is a foreground process that stays up; the default, written out for clarity. |
| `WorkingDirectory=/home/<you>/<repo>` | Where the process starts. `ExecStart` uses an absolute path, so this only affects the launcher's notion of `$PWD`; `--cwd` sets the server's scope explicitly. |
| `Environment=PATH=…` | The service's `PATH`. Must contain the directory with `pi` (here `~/.npm-global/bin`; adjust to `command -v pi`) and `node`. This is the setting most often missed: without it the server starts but sessions cannot spawn `pi`. |
| `ExecStart=…` | The exact command above: absolute `node`, absolute `dist/index.js`, and a `--cwd`, `--port`, `--allowed-origin` per project. |
| `Restart=on-failure` | Start again if the process exits non-zero (a crash). A clean exit (exit 0 after `SIGTERM`) is **not** restarted — matching launchd's `KeepAlive`/`SuccessfulExit` below. |
| `RestartSec=2` | Wait 2 s between restart attempts, so a crash loop does not spin. |
| `KillSignal=SIGTERM` | Stop the process with `SIGTERM`, which the launcher catches to run its bounded shutdown. |
| `TimeoutStopSec=30` | Give that shutdown up to 30 s before systemd escalates to `SIGKILL`. The launcher's steps are bounded (server close, then child stop with an escalation), so 30 s is comfortable. |
| `[Install]` / `WantedBy=default.target` | Makes `systemctl --user enable` wire the unit into the user manager, so it starts at login once linger is on. |

Install and start it (run these yourself; see [User actions](#user-actions)):

```bash
mkdir -p ~/.config/systemd/user
# write the unit file at ~/.config/systemd/user/pi-my-ui.<project>.service
systemctl --user daemon-reload
systemctl --user enable --now pi-my-ui.<project>
# keep the user manager (and the service) running after you log out:
loginctl enable-linger "$USER"
```

Without `enable-linger`, a user service stops when your last SSH session ends. With it, the service
starts at boot and survives logout — which is what "reachable from the phone" requires.

## macOS — a launchd LaunchAgent

Create `~/Library/LaunchAgents/pi-my-ui.<project>.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>pi-my-ui.<project></string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/<you>/<repo>/packages/server/dist/index.js</string>
    <string>--cwd</string>
    <string>/Users/<you>/projects/<project></string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string><port></string>
    <string>--allowed-origin</string>
    <string>https://pi.<tailnet>.ts.net</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/<you>/<repo></string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/<you>/.npm-global/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/<you>/Library/Logs/pi-my-ui/<project>.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/<you>/Library/Logs/pi-my-ui/<project>.err.log</string>
</dict>
</plist>
```

Line by line:

| Key | Why it is there |
|---|---|
| `Label` | The job's unique name; used by every `launchctl` command. Must match the plist filename stem. |
| `ProgramArguments` | The argv, one string per token — launchd does not run a shell, so the whole command is split out. Same flags as the Linux unit: `--cwd`, `--host`, `--port`, `--allowed-origin`. |
| `WorkingDirectory` | The process's initial directory; `--cwd` still sets the server's scope. |
| `EnvironmentVariables` → `PATH` | launchd's default `PATH` is minimal and will not contain `pi` (or a version-managed `node`); set it here, exactly as the systemd `Environment=` line does. Adjust the directory to `command -v pi`. |
| `RunAtLoad` | Start the job when it is loaded (at login/bootstrap). |
| `KeepAlive` → `SuccessfulExit=false` | Restart the job whenever it exits **unsuccessfully**, and leave it stopped after a clean `SIGTERM` exit. This is launchd's equivalent of systemd's `Restart=on-failure` — the two managers behave the same here. |
| `StandardOutPath` / `StandardErrorPath` | Where stdout (the `[pi-my-ui] …` startup lines) and stderr (warnings) go. launchd merges stdout into the unified log if you omit these, but explicit files are easier to read. Create the directory first: `mkdir -p ~/Library/Logs/pi-my-ui`. |

Load it (run these yourself):

```bash
mkdir -p ~/Library/Logs/pi-my-ui
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/pi-my-ui.<project>.plist
```

`launchctl bootstrap` loads and (with `RunAtLoad`) starts the job for your GUI session, so it comes back
at login.

> This guide was written on Linux, so the `launchctl` commands in this section were **not executed**
> here; they follow `launchd.plist(5)`.

> macOS note: `XDG_RUNTIME_DIR` is not set by launchd, so the bridge Unix socket falls back to the
> per-user `$TMPDIR` (`os.tmpdir()` in `packages/server/src/bridge/socket-path.ts`). That is the normal
> path on macOS; no extra environment variable is needed.

## Several projects at once

`pi-my-ui` is a **per-working-directory** server: one server, one working directory, one port
([ADR 0003](../adr/0003-one-server-per-cwd.md)). Run one unit per project, each with its own `--cwd`
and its own `--port`:

| Project | Unit / Label | `--cwd` | `--port` |
|---|---|---|---|
| `<project-a>` | `pi-my-ui.<project-a>` | `/home/<you>/projects/<project-a>` | `8787` |
| `<project-b>` | `pi-my-ui.<project-b>` | `/home/<you>/projects/<project-b>` | `8788` |
| `<project-c>` | `pi-my-ui.<project-c>` | `/home/<you>/projects/<project-c>` | `8789` |

- The default port is **8787**; give every other project a different one.
- Choose any free port above 1023 (below that needs root). Keep them in a range you can remember, e.g.
  8787–8799.
- The browser uses one tab per port (or, behind Caddy, one hostname per port); sessions for different
  projects never mix.
- Check a port is free before assigning it:
  ```bash
  ss -ltn | grep -E ':(8787|8788|8789)\b'    # Linux
  lsof -nP -iTCP -sTCP:LISTEN | grep 8787    # macOS
  ```

### What happens when the port is taken

The launcher fails **loudly and with a typed error naming `--port`** — it does not pick another port or
half-start. Starting a second server on a port that is already bound exits `1` with:

```
pi-my-ui: could not bind "127.0.0.1":8787: the port is already in use; change --port (EADDRINUSE)
```

(That is the real message; it is produced by `LauncherBindError` from the `EADDRINUSE` errno.) Under
systemd or launchd, `Restart=on-failure` / `KeepAlive.SuccessfulExit=false` means a mis-assigned port
becomes a visible restart loop in the logs rather than a silently missing server — which is why the
distinct-port step above matters. Fix it by changing `--port` (and the Caddy reverse-proxy target) to a
free port.

## Operations

Replace `pi-my-ui.<project>` with your unit/label name.

### Where the logs go

- **systemd** — stdout and stderr both go to the journal for the user unit:
  ```bash
  journalctl --user -u pi-my-ui.<project> -f          # follow
  journalctl --user -u pi-my-ui.<project> -n 100      # last 100 lines
  ```
  The startup lines (`[pi-my-ui] cwd: …`, `[pi-my-ui] local: …`) and the `SIGTERM received, shutting
  down` line are here; warnings (e.g. a missing bridge-extension build) go to stderr and so also land
  in the journal.
- **launchd** — the `StandardOutPath` / `StandardErrorPath` files from the plist:
  ```bash
  tail -f ~/Library/Logs/pi-my-ui/<project>.out.log
  tail -f ~/Library/Logs/pi-my-ui/<project>.err.log
  ```

### Restart

```bash
systemctl --user restart pi-my-ui.<project>                          # Linux
launchctl kickstart -k gui/$(id -u)/pi-my-ui.<project>               # macOS
```

Both stop the process (the launcher's `SIGTERM` shutdown runs) and start it again. See
[Restart vs. running sessions](#restart-vs-running-sessions) before restarting during a run.

### Stop

```bash
systemctl --user stop pi-my-ui.<project>                             # Linux
launchctl bootout gui/$(id -u)/pi-my-ui.<project>                    # macOS: unloads the job
```

`bootout` unloads the agent entirely; to load it again use `launchctl bootstrap` (above). To stop the
process without unloading, use `launchctl kill SIGTERM gui/$(id -u)/pi-my-ui.<project>`.

To keep it stopped across reboots, `systemctl --user disable pi-my-ui.<project>` (Linux) or remove the
plist (macOS).

### Confirm the server is up

`GET /healthz` is the up-check — the one route the launcher's HTTP app serves besides the WebSocket:

```bash
curl -fsS http://127.0.0.1:<port>/healthz
# {"status":"ok","service":"pi-my-ui-server"}
```

Through the proxy, the same path works from anywhere your Tailscale ACLs allow:

```bash
curl -fsS https://pi.<tailnet>.ts.net/healthz
```

A `200` with that body means the HTTP listener (and therefore the server process) is up. It does **not**
prove a `pi` session child is healthy — a session child is spawned lazily when you open a session, and
its state is shown in the UI (and in the logs when it fails). `curl -fsS` exits non-zero on a non-2xx
or a connection failure, so it is safe to script.

> The printed `local:` URL serves only `/healthz` and the WebSocket today; the built client is served by
> Caddy (E7-T2), not by the launcher. Confirming "up" is `/healthz`, not opening the bare port in a
> browser.

## Restart vs. running sessions

Sessions are `pi` **child processes** ([ADR 0002](../adr/0002-parallel-sessions-process-pool.md)) owned
by the server, and each session's **file** is the durable record
([ADR 0009](../adr/0009-session-discovery-and-creation.md)). That gives a precise restart story:

- **On shutdown** (stop, restart, or a signal), the launcher stops accepting connections, then stops
  **every child it owns** with a bounded, escalating stop, then removes the bridge socket, and exits `0`.
  No `pi` child is left running.
- **On reopen**, a session that is not currently running is respawned from its **session file**
  (`--session <path>`, [ADR 0014](../adr/0014-idle-eviction-policy.md)). The transcript and every
  completed turn are still there; a session that was evicted and a session that was restarted look the
  same when you open them. Respawn latency (process start) is the normal cost.
- **A restart interrupts an in-flight turn.** Idle eviction never kills a running turn
  ([ADR 0014](../adr/0014-idle-eviction-policy.md): a streaming turn is never evicted), but a **service
  restart stops the children unconditionally**, so a turn that is midway through a model call or a tool
  run does not finish across the restart.

**To avoid losing an in-flight run:** before stopping/restarting the service, let the session's current
turn finish — wait until the session shows no activity in the UI (the same "settled" state idle
eviction waits for), then restart. `--keep-alive` does **not** help here: it disables *idle eviction*,
not the shutdown stop. It is safe to restart while sessions are merely **open but idle**: they resume
from their files, and nothing is lost.

## QR code

There is **no QR-code option.** The launcher's flag surface has exactly `--cwd`, `--port`, `--host`,
`--idle-timeout`, `--keep-alive`, `--allowed-origin`, and `-h/--help`; it prints URLs only, and nothing
in `packages/*/src` generates a QR code. [ADR 0003](../adr/0003-one-server-per-cwd.md) records a QR code
as an *option* ("and optionally a QR code for the phone"), but it is not implemented. To get the URL
onto the phone, open the Tailscale name `https://pi.<tailnet>.ts.net` (set up in the Caddy + Tailscale
guide, E7-T2) by hand. The unit in this guide binds `--host 127.0.0.1`, so the launcher prints a
`[pi-my-ui] local:` line and **no** `phone:` line; both the `local:` line and a `phone:` line (only
when you bind beyond loopback) are in `journalctl` / the launchd log. Do not pass a `--qr`-style flag:
the launcher rejects any unknown flag with a typed error.

## User actions

Things only you can do, in order. None of these are run by the repository's `verify`.

1. **Once, per machine:**
   - `cd /home/<you>/<repo> && npm ci && npm run build`.
   - `command -v node` (must be Node ≥ 22.22.2) and `command -v pi` — note both directories for the
     unit's `PATH`.
2. **Once, per project — Linux (systemd):**
   - `mkdir -p ~/.config/systemd/user`.
   - Write `~/.config/systemd/user/pi-my-ui.<project>.service` from the unit above, replacing
     `<project>`, `<port>`, `<tailnet>`, and the paths/`PATH`.
   - `systemctl --user daemon-reload`
   - `systemctl --user enable --now pi-my-ui.<project>`
   - `loginctl enable-linger "$USER"` (so it survives logout and starts at boot).
   - `curl -fsS http://127.0.0.1:<port>/healthz` → expect `{"status":"ok","service":"pi-my-ui-server"}`.
3. **Once, per project — macOS (launchd):**
   - `mkdir -p ~/Library/Logs/pi-my-ui`.
   - Write `~/Library/LaunchAgents/pi-my-ui.<project>.plist` from the plist above, replacing **every**
     `<…>` placeholder (`<you>`, `<repo>`, `<project>`, `<port>`, `<tailnet>`) — the file is not valid
     XML until each one is substituted.
   - `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/pi-my-ui.<project>.plist`
   - `curl -fsS http://127.0.0.1:<port>/healthz` → the same body.
4. **Once, for reachability:** set up Caddy + Tailscale per the Caddy + Tailscale guide (E7-T2), using
   the same `<port>` and the same `https://pi.<tailnet>.ts.net` origin in both the unit and the Caddyfile.
5. **Per project:** repeat steps 2 or 3 with a distinct `<port>`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Service restarts in a loop, log says `the port is already in use; change --port (EADDRINUSE)` | Two units share a `<port>`. Give this project a free `<port>` and update its Caddy target. |
| Log says `refusing to bind to 0.0.0.0: binding beyond loopback requires at least one --allowed-origin` | You set `--host` beyond loopback without the origin flag. Keep `--host 127.0.0.1` and let Caddy be the only reachable surface, or add the origin. |
| Log says `--allowed-origin must be an origin without a path, query, fragment, or credentials` | The origin is not a bare `scheme://host[:port]`. Use e.g. `https://pi.<tailnet>.ts.net`. |
| Server is up (`/healthz` 200) but the phone's chat never connects / WebSocket closes immediately | The configured `--allowed-origin` does not match the hostname the browser is on, or `Host` is unexpected. Compare the Caddy hostname and the origin value exactly. |
| A session will not spawn (`pi: not found` or similar in the logs) | The service's `PATH` does not contain `pi`. Fix `Environment=PATH=…` / `EnvironmentVariables`, then restart. |
| Service stops when you log out (Linux) | `loginctl enable-linger "$USER"` was not run. |
| `launchctl bootstrap` fails with `Bootstrap failed: 5: Input/output error` | The job is already loaded: `launchctl bootout gui/$(id -u)/pi-my-ui.<project>` first, then bootstrap again. |
| After `git pull`, the service runs old code | Rebuild the launcher: `npm run build`, then restart the unit. |

## Related

- Launcher: `packages/server/src/launcher/` (flags, config validation, URLs, shutdown).
- [ADR 0003 — one server per working directory](../adr/0003-one-server-per-cwd.md)
- [ADR 0013 — exposure and security model](../adr/0013-exposure-and-security.md)
- [ADR 0014 — idle eviction policy](../adr/0014-idle-eviction-policy.md)
- Ticket: [E7-T3 Service unit & launch docs](../project/deployment-and-security/service-unit-and-launch-docs/ticket.md)

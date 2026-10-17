# Running pi-my-ui as a service

Keep one `pi-my-ui` server per project running across SSH logins and reboots. On Linux this is a
**systemd user unit**; on macOS it is a **launchd LaunchAgent**. Both run the same entry point with
the same flags and restart on failure.

The server binds **loopback only** by default. Caddy is what the phone reaches; this guide is the
service half, and the [Caddy + Tailscale guide](caddy.md) is the proxy half.

## Placeholders used below

| Placeholder  | Means                                                           | Example                                     |
| ------------ | --------------------------------------------------------------- | ------------------------------------------- |
| `/home/<you>` | your home directory                                            | `/home/ana`                                 |
| `/Users/<you>` | your home directory on macOS                                  | `/Users/ana`                                |
| `<repo>`     | where you cloned pi-my-ui                                       | `pi-my-ui`                                  |
| `<project>`  | the project whose Sessions this server owns                     | `webapp`                                    |
| `<port>`     | a TCP port unique **on this machine**                           | `8787`                                      |
| `<origin>`   | the exact browser origin from the Caddy guide                   | `https://laptop.tailnet-name.ts.net`        |

Nothing in the repository hard-codes a machine path; set every value in the files below.

## Prerequisites

1. **Node.js >= 22.22.2** on the machine. The service runs the **built** server, so the build must
   exist and be current:

   ```bash
   cd /home/<you>/<repo>
   npm ci
   npm run build
   ```

   `npm ci` replaces `node_modules`, and the server runs what `dist/` holds, so run the build after
every install and every pull. The build also produces the bridge extension the server loads.

2. **The pinned pi package.** The server spawns `node <node_modules>/@earendil-works/pi-coding-agent/dist/cli.js`
   for each Session, using the version this repository pins. There is no separate `pi` command to
   install on `PATH`, but **`node` must be on the service's `PATH`** — the child is spawned by name.

3. **pi credentials** under `~/.pi` for the user the service runs as. The service manager must set
   `HOME` to that user's home; both unit types below run as a user service, which does.

4. **Caddy plus Tailscale**, per the [Caddy + Tailscale guide](caddy.md), including the
   `--allowed-origin` value.

5. **A user service, not root.** The server binds an unprivileged port on loopback and starts child
   processes as your user. Do not run it as a system-wide or root service.

## The launch command

Run the built entry point by absolute path. It is a stable path and produces no npm wrapper output,
both of which matter when a manager, not a shell, starts the process:

```bash
node /home/<you>/<repo>/packages/server/dist/cli.js --help
```

An installed workspace also links `node_modules/.bin/pi-my-ui` to that file; it is usable after an
install that follows a build, but a service unit should name the absolute file.

The flags (`--help` prints the same list):

| Flag                        | Meaning                                                                     | Default               |
| --------------------------- | --------------------------------------------------------------------------- | --------------------- |
| `--cwd <dir>`               | Working directory the server is scoped to; its Sessions and files           | the current directory |
| `--port <port>`             | TCP port to listen on                                                       | `8787`                |
| `--host <address>`          | Address to bind; beyond loopback requires `--allowed-origin`                 | `127.0.0.1`           |
| `--idle-timeout <seconds>`  | Evict an idle, unwatched Session's child after this long                    | `120`                 |
| `--keep-alive`              | Disable idle eviction entirely                                              | off                   |
| `--allowed-origin <origin>` | Browser origin allowed to connect; repeatable; a bare `scheme://host[:port]` | none                  |
| `-h`, `--help`              | Print usage and exit                                                        | —                     |

On start it prints one line per fact to stdout:

```text
pi-my-ui: cwd /home/<you>/projects/<project>
pi-my-ui: listening on http://127.0.0.1:8787
```

A `bridge: listening on /run/user/<uid>/pi-my-ui-<port>/bridge.sock` line and one line per Pi child
go to stderr. Keep both streams; they are the service's record.

### The invocation both units use

```bash
node /home/<you>/<repo>/packages/server/dist/cli.js \
  --cwd /home/<you>/projects/<project> \
  --host 127.0.0.1 \
  --port <port> \
  --allowed-origin <origin>
```

- `--host 127.0.0.1` is the default, written out so the security intent is visible: only the local
  Caddy can reach the server.
- `--allowed-origin <origin>` is what lets the page Caddy serves open the WebSocket. It must be one
  bare origin, exactly matching what the browser sends. A value with a path, query, fragment,
  credentials, or a `*` is refused at startup with an error naming the flag.
- Add `--keep-alive` only if you want Sessions never evicted while idle. It does **not** make a
  restart non-destructive (see [Restart vs running Sessions](#restart-vs-running-sessions)).

## Linux — a systemd user unit

A unit's **name is its filename stem**, so the file and every `systemctl`/`journalctl` command below
share one spelling: `pi-my-ui.<project>` (with `<project>` = `webapp`, the file is
`pi-my-ui.webapp.service` and the command is `systemctl --user … pi-my-ui.webapp`).

Create `~/.config/systemd/user/pi-my-ui.<project>.service`:

```ini
[Unit]
Description=pi-my-ui server for <project> (/home/<you>/projects/<project>)

[Service]
Type=simple
WorkingDirectory=/home/<you>/<repo>
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /home/<you>/<repo>/packages/server/dist/cli.js --cwd /home/<you>/projects/<project> --host 127.0.0.1 --port <port> --allowed-origin <origin>
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Line by line:

| Line                                       | Why it is there                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Description=`                             | An identifier in `systemctl --user status` and the journal.                                             |
| `Type=simple`                              | The server is a foreground process that stays up.                                                       |
| `WorkingDirectory=`                        | The process's initial directory; `--cwd` still sets the server's scope explicitly.                      |
| `Environment=PATH=…`                       | Must contain the directory with `node`, because each Pi child is spawned as `node` by name. Adjust it to `command -v node`. |
| `ExecStart=`                               | Absolute `node`, absolute `dist/cli.js`, and this project's `--cwd`, `--port` and `--allowed-origin`. Adjust `/usr/bin/node` if your node lives elsewhere. |
| `Restart=on-failure`                       | Restart after a crash. A clean exit after `SIGTERM` is not restarted, matching launchd's `KeepAlive`.    |
| `RestartSec=2`                             | A pause between attempts, so a crash loop does not spin.                                                |
| `KillSignal=SIGTERM`                       | The server catches it and runs its bounded shutdown, stopping every Pi child it started.                 |
| `TimeoutStopSec=30`                        | Give that shutdown time before systemd escalates to `SIGKILL`.                                          |
| `[Install]` / `WantedBy=default.target`    | `systemctl --user enable` wires the unit into the user manager so it starts at login.                   |

Install and start it (run these yourself; see [User actions](#user-actions)):

```bash
mkdir -p ~/.config/systemd/user
# write the unit file at ~/.config/systemd/user/pi-my-ui.<project>.service
systemctl --user daemon-reload
systemctl --user enable --now pi-my-ui.<project>
# keep the user manager, and the service, running after you log out:
loginctl enable-linger "$USER"
```

Without `enable-linger`, a user service stops when your last SSH session ends. With it, the service
starts at boot and survives logout.

## macOS — a launchd LaunchAgent

Create `~/Library/LaunchAgents/pi-my-ui.<project>.plist`. The example below uses user `ana`, repo
`pi-my-ui`, project `webapp`, port `8787` and the tailnet name from §2; substitute your own values,
including the node path from `command -v node`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>pi-my-ui.webapp</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/ana/pi-my-ui/packages/server/dist/cli.js</string>
    <string>--cwd</string>
    <string>/Users/ana/projects/webapp</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8787</string>
    <string>--allowed-origin</string>
    <string>https://laptop.tailnet-name.ts.net</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/ana/pi-my-ui</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/ana/Library/Logs/pi-my-ui/webapp.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/ana/Library/Logs/pi-my-ui/webapp.err.log</string>
</dict>
</plist>
```

Line by line:

| Key                                            | Why it is there                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Label`                                        | The job's unique name, used by every `launchctl` command; it must match the filename stem.           |
| `ProgramArguments`                             | The argv, one string per token: launchd runs no shell, so the command is split out.                  |
| `WorkingDirectory`                             | The initial directory; `--cwd` still sets the server's scope.                                        |
| `EnvironmentVariables` → `PATH`                | Must contain the directory with `node`, because each Pi child is spawned as `node` by name. Adjust it to `command -v node`.          |
| `RunAtLoad`                                    | Start the job when it is loaded, at login.                                                           |
| `KeepAlive` → `SuccessfulExit=false`           | Restart on failure and leave it stopped after a clean `SIGTERM` exit.                                |
| `StandardOutPath` / `StandardErrorPath`        | Where the startup lines and the warnings go. Create the directory first.                             |

Load it (run these yourself):

```bash
mkdir -p ~/Library/Logs/pi-my-ui
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/pi-my-ui.<project>.plist
```

On macOS, `XDG_RUNTIME_DIR` is not set, so the bridge socket falls back to the per-user temp
directory (`os.tmpdir()`). That is normal; no extra environment variable is needed. The server creates
the socket directory user-only and removes it on shutdown.

## Several projects at once

The server is **per working directory**: one server, one working directory, one port. Run one unit per
project, each with its own `--cwd`, `--port` and `--allowed-origin`:

| Project       | Unit / Label              | `--cwd`                         | `--port` | `--allowed-origin`                  |
| ------------- | ------------------------- | ------------------------------- | -------- | ----------------------------------- |
| `<project-a>` | `pi-my-ui.<project-a>`    | `/home/<you>/projects/<a>`      | `8787`   | `https://laptop.tailnet-name.ts.net` |
| `<project-b>` | `pi-my-ui.<project-b>`    | `/home/<you>/projects/<b>`      | `8788`   | `https://laptop.tailnet-name.ts.net:8444` |

- The default port is `8787`; give every other project a different one above 1023.
- Each project needs its own phone address. On one hostname the second project uses its own port,
  which is part of the origin, so the allowlist value includes the port. The
  [Caddy guide](caddy.md#42-more-than-one-project) has that site block.
- Check a port is free before assigning it:
  ```bash
  ss -ltn | grep -E ':(8787|8788)\b'         # Linux
  lsof -nP -iTCP -sTCP:LISTEN | grep 8787   # macOS
  ```

### What happens when the port is taken

The launcher fails loudly with a typed error naming `--port`; it does not pick another port or
half-start. Starting a second server on a bound port exits `1` with:

```text
pi-my-ui: could not bind "127.0.0.1":8787: the port is already in use; change --port (EADDRINUSE)
```

Under systemd or launchd, `Restart=on-failure` / `KeepAlive.SuccessfulExit=false` turns a
mis-assigned port into a visible restart loop in the logs rather than a silently missing server. Fix
it by changing `--port` and the Caddy upstream.

## Operations

Replace `pi-my-ui.<project>` with your unit or label name.

### Where the logs go

- **systemd** — stdout and stderr go to the user journal:
  ```bash
  journalctl --user -u pi-my-ui.<project> -f          # follow
  journalctl --user -u pi-my-ui.<project> -n 100      # last 100 lines
  ```
  The startup lines and the `SIGTERM received, shutting down` line are here, as are bridge warnings
  and refused-origin lines.
- **launchd** — the files from the plist:
  ```bash
  tail -f ~/Library/Logs/pi-my-ui/<project>.out.log
  tail -f ~/Library/Logs/pi-my-ui/<project>.err.log
  ```

### Restart and stop

```bash
systemctl --user restart pi-my-ui.<project>                          # Linux
launchctl kickstart -k gui/$(id -u)/pi-my-ui.<project>               # macOS

systemctl --user stop pi-my-ui.<project>                             # Linux
launchctl bootout gui/$(id -u)/pi-my-ui.<project>                    # macOS: unloads the job
```

`launchctl bootout` unloads the agent entirely; load it again with `launchctl bootstrap`. To stop
without unloading, use `launchctl kill SIGTERM gui/$(id -u)/pi-my-ui.<project>`. To keep it stopped
across reboots, `systemctl --user disable pi-my-ui.<project>` or remove the plist.

### Confirm the server is up

`GET /healthz` is the up-check:

```bash
curl -fsS http://127.0.0.1:<port>/healthz
# {"status":"ok","service":"pi-my-ui-server"}
```

Through the proxy, the same path works from anywhere your Tailscale ACLs allow:

```bash
curl -fsS <origin>/healthz
```

A `200` with that body means the HTTP listener is up. It does **not** prove a Pi child is healthy: a
Session's child starts lazily when you open the Session, and its state is shown in the UI and in the
logs. `curl -fsS` exits non-zero on a non-2xx or a connection failure, so it is safe to script.

## Restart vs running Sessions

Sessions are **Pi children** owned by the server, and each Session's **file** is the durable record.
That gives a precise restart story:

- **On shutdown** (stop, restart, or a signal), the server stops accepting connections, stops every
  child it owns with a bounded, escalating stop, removes the bridge socket, and exits `0`. No `pi`
  child is left running.
- **On reopen**, a Session that is not running is started from its **Session file**. The transcript
  and every completed turn are still there; an evicted Session and a restarted Session look the same
  when you open them. The cost is the process start, shown as **Starting…**.
- **A restart interrupts an in-flight turn.** Idle eviction never stops a running turn, but a service
  restart stops children unconditionally, so a turn midway through a model call or a tool run does
  not finish across the restart.

**To avoid losing an in-flight run:** let the Session's current turn finish — wait until the Session
shows no activity in the UI — then restart. `--keep-alive` does not help here: it disables idle
eviction, not the shutdown stop. Restarting while Sessions are merely open and idle is safe; they
resume from their files.

## Troubleshooting

| What you see                                                                 | Why                                                                 | What to do                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A restart loop in the journal, with `the port is already in use; change --port` | Two units share a port.                                              | Give this project a free `--port` and update its Caddy upstream.            |
| `refusing to bind to 0.0.0.0: binding beyond loopback requires at least one --allowed-origin` | `--host` was widened without an origin.                              | Keep `--host 127.0.0.1` and let Caddy be the only surface, or add the origin. |
| `--allowed-origin must be a bare origin …`                                    | The value has a path, query, fragment, credentials or a wildcard.    | Use one bare `scheme://host[:port]` per flag, repeated as needed.           |
| The service is up (`/healthz` is 200) but the phone never connects            | The allowed origin does not match the browser's origin.              | Compare the `refused WebSocket upgrade` line's origin with `--allowed-origin`. |
| A Session fails to start, and the log says the bridge did not connect         | The bridge extension is missing from the build, or the child cannot reach the socket. | Run `npm run build` and restart the service; check `node` is on the service's `PATH`. |
| `spawn node ENOENT`, or a Session errors immediately after a deploy            | The service's `PATH` lacks the directory containing `node`.          | Fix `Environment=` / `EnvironmentVariables`, then restart.                  |
| pi reports a missing credential                                              | The service does not run as the user who logged in to pi, or `HOME` is wrong. | Run the service as that user and confirm `~/.pi` exists for it.              |
| The service stops when you log out (Linux)                                    | `loginctl enable-linger "$USER"` was not run.                        | Enable linger, then start the unit again.                                   |
| `launchctl bootstrap` fails with `Bootstrap failed: 5: Input/output error`    | The job is already loaded.                                           | `launchctl bootout gui/$(id -u)/pi-my-ui.<project>`, then bootstrap again.   |
| After a pull the service runs old code                                        | `dist/` was not rebuilt.                                             | `npm ci && npm run build`, then restart the unit.                           |

## User actions

Things only you can do, in order. None are run by the repository's checks.

1. **Once per machine:** `cd /home/<you>/<repo> && npm ci && npm run build`; confirm
   `command -v node` and note its directory for the unit's `PATH`; confirm `~/.pi` has working pi
   credentials for the service user.
2. **Once per project (Linux):** write
   `~/.config/systemd/user/pi-my-ui.<project>.service`, replacing every placeholder; run
   `systemctl --user daemon-reload`, `systemctl --user enable --now pi-my-ui.<project>`, and
   `loginctl enable-linger "$USER"`; check
   `curl -fsS http://127.0.0.1:<port>/healthz`.
3. **Once per project (macOS):** write `~/Library/LaunchAgents/pi-my-ui.webapp.plist` from the
   example, replacing every value with your own; `launchctl bootstrap gui/$(id -u)
   ~/Library/LaunchAgents/pi-my-ui.webapp.plist`; check the same health URL.
4. **Once for reachability:** set up Caddy plus Tailscale per the
   [Caddy + Tailscale guide](caddy.md), using the same port and origin as the unit.
5. **Per additional project:** repeat with a distinct port, origin and unit name.

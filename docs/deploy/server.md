# Running the server on the host

The server is a node process on the host, started by hand and kept alive by whatever shell you leave
it in; Caddy runs in front of it from [compose](compose.md). There is no service definition: a
hardened container around the server bought nothing here (host networking, your UID, the repository
mounted read-write) and cost a rebuild step, a mounts table and a second home for the logs. The
[deploy overview](README.md) has the path diagram, the prerequisites and the three commands.

## The one environment file

`deploy/.env` holds every machine value, and both halves read that same file: compose takes Caddy's
values from it, and the start command below sources it. The values:

| Value                   | Means                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `PI_MY_UI_REPO`         | this repository, absolute                                      |
| `PI_MY_UI_PORT`         | the backend port; Caddy's upstream is the same value           |
| `PI_MY_UI_TAILNET_NAME` | the MagicDNS name, which is also the `--allowed-origin` origin |
| `PI_MY_UI_PROJECTS`     | the whole `--project` list, quoted, one flag per Project       |

`PI_MY_UI_TAILNET_IPV4`/`IPV6` are Caddy's; nothing else reads them.

## Start it

The start command expands the file into flags. The Project list is one quoted value there, so it
stays unquoted here and word-splits into repeated `--project` flags — that is bash and sh behaviour;
zsh does not split it.

```bash
cd /home/you/pi-my-ui
set -a; . deploy/.env; set +a

node packages/server/dist/cli.js $PI_MY_UI_PROJECTS \
  --port "$PI_MY_UI_PORT" \
  --host 127.0.0.1 \
  --allowed-origin "https://$PI_MY_UI_TAILNET_NAME"
```

- **`--host 127.0.0.1`** is deliberate: the server must stay unreachable except through Caddy, which
  shares the host's network namespace and proxies from loopback.
- **`--allowed-origin`** is the origin the browser sends: the tailnet name with `https://` and no
  path, port or trailing dot. It is exactly the string Caddy's site address serves.
- **`--workspace`** is not passed here, so it defaults to the directory the command runs in: the
  repository. Every directory under it holding a `.git` folder is discovered as a Project, the
  repository itself included.
- **`--project`** repeats once per Project, and keeps the order you typed. A mount does not make
  something a Project, and a discovered Project inside another one is served as its own row. Naming
  the same path twice is refused, with the path in the message.

A healthy start prints the workspace, one `pi-my-ui: project <path>` line per `--project`, then the
listening line, plus a `bridge: listening on …` line and one line per Pi child. Discovery happens when
someone asks for the Project list, so the banner does not name discovered Projects. Keep `/healthz`
for the cheap check that the listener is up; it says nothing about a Pi child, which starts lazily
when a Session opens.

```bash
curl -sS http://127.0.0.1:8787/healthz
# → {"status":"ok","service":"pi-my-ui-server"}
```

## Keep it running

Nothing restarts this process for you. Run it inside tmux (or a terminal you leave open) so a
detached session keeps the app up:

```bash
tmux new -s pi-my-ui
# paste the start command above, then detach with Ctrl-b d
tmux attach -t pi-my-ui          # to come back to the log
```

After a reboot, or after the process dies, start it again the same way. Caddy survives on its own
(`restart: unless-stopped`) and answers `502` until the server is listening again.

**`Ctrl-C` is the shutdown.** The server stops every Pi child it started before exiting, so let the
shutdown finish instead of closing the pane on it.

## Logs, restarts, the port

The log is the pane you started the server in. Everything the app writes goes there: the startup
lines, `refused WebSocket upgrade: origin "…" is not in the allowlist`, bridge failures, and pi's own
stderr forwarded per child. Scrolling back in tmux (`Ctrl-b [`) is the search.

To restart: `Ctrl-C` in the pane, then the start command again. To pick up an environment change —
the `--project` list, another port — restart is the moment it takes effect, because the flags are read
at launch. A Project created from the browser, or discovered inside the workspace, needs no restart.

The launcher exits rather than picking another port:

```text
pi-my-ui: could not bind "127.0.0.1":8787: the port is already in use; change --port (EADDRINUSE)
```

One server serves every Project you pass, so a second Project does not need a port of its own. Find
the holder with `ss -ltn` (Linux) or `lsof -nP -iTCP -sTCP:LISTEN` (macOS); if it is a development
server, change `PI_MY_UI_PORT` and restart Caddy so its upstream follows, or run the dev server on
another port.

## Upgrading, and what a restart costs

- **Pull and rebuild:** `git pull`, `npm ci`, `npm run build`, then restart the server. Caddy needs
  nothing: it serves `packages/client/dist` from the mounted repository.
- **Sessions are durable.** Each Session's file is the record, so a stopped Session and a restarted
  one look the same when you open them, at the cost of a process start shown as **Starting…**.
- **A restart interrupts an in-flight turn.** Idle eviction never stops a running turn, but the
  shutdown stops every Pi child unconditionally. Wait until the Session shows no activity.

# pi-my-ui

A phone-first web UI for [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). A
local server owns your Sessions and runs a real `pi` process for each one; the browser is a thin
client that can drop and rejoin without losing the work.

The server is a backend only: it exposes a health endpoint, a file-download endpoint and one
WebSocket. A static host serves the built client and proxies those routes. Nothing is reachable
until you deliberately bind beyond loopback and allow your browser's origin.

## Requirements

- **Node.js >= 22.22.2** and npm. The floor is in the root `package.json` (`engines`).
- **pi credentials** under `~/.pi` for the user that runs the server. Run `pi` in a terminal once
  to log in (a global install is only needed for that); the server launches the workspace's pinned
  `@earendil-works/pi-coding-agent` package as a child and does not need `pi` on `PATH`.
- **Docker and a private tailnet** to reach the app from a phone. The server runs from node on the
  host; Caddy runs in a container in front of it. The [server guide](docs/deploy/server.md) is the
  server, the [Caddy guide](docs/deploy/caddy.md) the network and TLS, the
  [compose guide](docs/deploy/compose.md) Caddy's container.
- **Chromium** for the browser suite: `npx playwright install chromium`.

Both gates need no model credentials and never touch your real `~/.pi`: the test suite runs real pi
in a hermetic home with a scripted model provider.

## Install and build

```bash
npm ci
npm run build
```

`npm run build` produces the server entry point (`packages/server/dist/cli.js`), the client bundle
(`packages/client/dist`), the protocol types and the bridge extension.

## Layout

Six packages in one npm workspace:

| Package                       | What it is                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@pi-my-ui/protocol`          | The wire contract: message types, validators, the Delta reducer, Cursor semantics                        |
| `@pi-my-ui/server`            | HTTP and WebSocket backend; owns the Session pool and each Session's Projection                          |
| `@pi-my-ui/client`            | Svelte 5 phone UI, fed by one stream of `ServerMessage` values                                           |
| `@pi-my-ui/bridge-extension`  | pi extension loaded into every Pi child; reaches past pi's RPC for subagents and Leaf moves              |
| `@pi-my-ui/scripted-provider` | A pi model-provider extension that replays recorded replies (test-only)                                  |
| `@pi-my-ui/e2e`               | Hermetic harness, fixture builder, the browser suite under Playwright and the backend suite under vitest |

The deployment lives outside the packages, in `deploy/`: a `compose.yaml` running Caddy, the
`Caddyfile`, and a `.env.example` that both Caddy and the server read. The
[server guide](docs/deploy/server.md) is how the server runs on the host; the
[compose guide](docs/deploy/compose.md) is Caddy's container.

The bridge is required. It ships with this repository and is loaded into every Pi child
automatically; if it cannot load or connect, the Session or the server start reports the failure
and there is no mode that runs without it.

## Run the server

```bash
node packages/server/dist/cli.js --workspace ~/work --port 8787
```

`--workspace` names the directory the server is anchored to, default the directory you run the
command from. Every Project discovered inside it is served, and a Project created from the browser is
made directly inside it; nothing outside it is ever created.

`--project` names one Project explicitly: one absolute path, whose Sessions and files are the only
ones served for that Project. Repeat the flag to serve several Projects from one server, in the order
you type them, and it is how a repository outside the workspace is served, for example
`--workspace ~/work --project ~/oss/api`. `--port` defaults to `8787`. One server means one URL and
one WebSocket, however many Projects it serves.

The working directory is an anchor, not a served Project: running in a repository serves it because
discovery finds its `.git`, and running in a plain directory serves nothing until a Project is
created. Every directory under the workspace holding a `.git` entry is a Project, the only marker the
server looks for, and the server runs no git command. Creating a Project makes one empty directory and
registers it; version control is your next move, run inside the new Project. A server with no Project
starts normally, on an empty picker that offers creation.

The browser remembers the last Project you chose on that device and skips the picker when the server
serves exactly one. `?project=<absolute path>` opens a Project directly, so a bookmark or homescreen
shortcut lands in the right repository. A healthy start prints the workspace, one
`pi-my-ui: project <path>` line per `--project`, then the listening line:

```text
pi-my-ui: workspace /home/you/work
pi-my-ui: project /path/to/project
pi-my-ui: listening on http://127.0.0.1:8787
```

A `bridge: listening on …` line also goes to stderr, followed by one line per Pi child the bridge
serves. `node packages/server/dist/cli.js --help` lists every flag; the user guide describes them
in [Launcher flags](docs/guide.md#launcher-flags).

The printed address is a backend address. `GET /healthz` answers
`{"status":"ok","service":"pi-my-ui-server"}` and `POST /files/download?project=…&path=…` streams
one file; every other path, including `/`, answers `404`. Stop the server with `Ctrl-C`: it stops
every Pi child it started before exiting.

## Run the client

In production the server runs from node on the host ([server guide](docs/deploy/server.md)) and
`deploy/compose.yaml` runs Caddy: Caddy serves `packages/client/dist`, terminates TLS on the tailnet
with its own local CA, and reverse-proxies `/ws`, `/healthz` and `/files/download` to the loopback
server. The [Caddy guide](docs/deploy/caddy.md) has the certificate story and the
[compose guide](docs/deploy/compose.md) Caddy's container. The page
address names the Project to open, as `?project=<absolute path>`, and, within it,
the Session, as `?session=<id>`. A Session link also needs its Project: either `?project=` in the
same address, or a Project this device remembers, or a server that serves only one. The
[user guide](docs/guide.md#5-opening-a-session) explains how to get an id.

For client development, Vite serves the source and proxies the real backend:

```bash
# terminal 1: the backend
node packages/server/dist/cli.js --workspace ~/work --project /path/to/project --port 8787

# terminal 2: the client
npm exec --workspace @pi-my-ui/client -- vite dev
```

If the deployed server is running it already holds `8787`: run this backend on `--port 8788` and set
`PI_MY_UI_BACKEND_ORIGIN=http://127.0.0.1:8788` for Vite.

Open the URL Vite prints. With no `?project=` the link connects and shows the picker, or the only
Project; choosing one opens its Sessions, and its `+` starts a new Session. Adding
`?project=<absolute path>` lands in that Project, and adding `?session=<id>` as well opens that
Session directly. The proxy forwards
`/ws` and `/healthz` to `http://127.0.0.1:8787`; set `PI_MY_UI_BACKEND_ORIGIN` to point it at a
backend on another port. File downloads are not proxied in development, so the download button needs
the Caddy setup. A browser on `localhost` or `127.0.0.1` is accepted without an allowlist; if you
pass `--allowed-origin`, add the exact dev origin you open (for example
`--allowed-origin http://localhost:5173`).

## Commands

| Command                      | What it does                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`             | **The fast gate.** Typecheck (tests included) → lint, hygiene, e2e style and fixture checks → format check → build → store, component and backend tests. Stops before the browser suite. |
| `npm run verify:full`        | The fast gate plus the browser suite (one Playwright process, eight workers).                                                                                                            |
| `npm run typecheck`          | Build the protocol package, then typecheck every workspace including tests                                                                                                               |
| `npm run lint`               | ESLint, the comment hygiene, e2e style and fixture checks                                                                                                                                |
| `npm run format`             | Prettier write                                                                                                                                                                           |
| `npm run format:check`       | Prettier check (non-mutating)                                                                                                                                                            |
| `npm run test`               | Store and component tests plus the backend suite                                                                                                                                         |
| `npm run build`              | Build every workspace                                                                                                                                                                    |
| `npm run test:e2e`           | The Playwright browser suite in one process, pinned to eight workers and failing over a 45 s budget                                                                                      |
| `npm run test:e2e:raw`       | The same browser suite without the stopwatch, for when a run is expected to be slow                                                                                                      |
| `npm run test:smoke`         | Opt-in: record one real-provider run and replay it through the scripted provider                                                                                                         |
| `npm run measure:pool`       | Measure the pool's resident memory and eviction behaviour                                                                                                                                |
| `npm run rerecord -- <name>` | Re-record one scripted-provider script from a real provider run                                                                                                                          |

The browser commands need a build first (`npm run build`) and a one-time
`npx playwright install chromium`.

### What the gates cover

`npm run verify` stops after the store, component and backend tests. `npm run verify:full` adds the
browser suite.

- **Typecheck** covers tests as well as source.
- **Lint** includes `scripts/hygiene-check.mjs`, which fails on a ticket id or a date in a source
  comment, and warns on a file over 400 code lines or a high comment ratio. It also includes
  `scripts/e2e-style-check.mjs`, which rejects raw theme colours in e2e specs.
- **Store and component tests** feed `ServerMessage` values straight into the client store and
  assert on rendered output. They never open a socket and never touch a store internal.
- **Backend suite** runs under vitest in a node environment against the built server, with real Pi
  children and a real WebSocket. It carries the Claims that need a real server, socket or child but
  no browser.
- **Browser suite** runs under Playwright with a real browser against real pi, in a hermetic home
  per test, with the scripted provider as the only substitute for the model and the real bridge
  loaded. Reconnect and resync are exercised through a test-only hook that drops viewer
  connections. It carries the Claims that need a browser or a layout engine.
- **Fixture check** refuses a committed raw or oversized pi Session file; only the curated,
  sanitised seeds under `packages/e2e/fixtures/seeds` are allowed.

The suite does not need model credentials. The opt-in smoke test is the only test that does:
`npm run test:smoke` skips loudly unless `ANTHROPIC_API_KEY` (or the chosen provider's variable) is
set, and it never runs as part of either gate.

## Documentation

- [User guide](docs/guide.md) — every screen and control, from the phone's point of view.
- [Troubleshooting](docs/troubleshooting.md) — what you see, why, and what to do.
- [Caddy on a private tailnet](docs/deploy/caddy.md) — the phone address, TLS with a local CA, the
  origin allowlist.
- [Deployment](docs/deploy/README.md) — the prerequisites, the three commands, everyday logs and
  restarts.
- [Host deployment](docs/deploy/server.md) — starting the server by hand, its one environment file,
  logs and restarts.
- [Docker Compose](docs/deploy/compose.md) — Caddy only: the proxy, the certificate volume, logs and
  restarts.
- [Architecture decisions](docs/adr/) — the choices and their costs.
- [Measurements](docs/measurements.md) — the numbers the pool defaults come from.
- [Glossary](GLOSSARY.md) — Session, Pi child, Projection, Snapshot, Delta, Cursor, Leaf, Bridge,
  Subagent, Journey, Claim, Wiring claim, Browser suite, Backend suite, Rig.

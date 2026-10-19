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
- **Caddy plus Tailscale** to reach the app from a phone. The exact setup is in the
  [Caddy + Tailscale guide](docs/deploy/caddy.md).
- **Chromium** for the browser tests: `npx playwright install chromium`.

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

| Package                       | What it is                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `@pi-my-ui/protocol`          | The wire contract: message types, validators, the Delta reducer, Cursor semantics           |
| `@pi-my-ui/server`            | HTTP and WebSocket backend; owns the Session pool and each Session's Projection             |
| `@pi-my-ui/client`            | Svelte 5 phone UI, fed by one stream of `ServerMessage` values                              |
| `@pi-my-ui/bridge-extension`  | pi extension loaded into every Pi child; reaches past pi's RPC for subagents and Leaf moves |
| `@pi-my-ui/scripted-provider` | A pi model-provider extension that replays recorded replies (test-only)                     |
| `@pi-my-ui/e2e`               | Hermetic harness, fixture builder and the Playwright end-to-end suite                       |

The bridge is required. It ships with this repository and is loaded into every Pi child
automatically; if it cannot load or connect, the Session or the server start reports the failure
and there is no mode that runs without it.

## Run the server

```bash
node packages/server/dist/cli.js --project /path/to/project --port 8787
```

`--project` names one Project the server serves: one absolute path, whose Sessions and files are the
only ones served for that Project. Repeat the flag to serve several Projects from one server, for
example `--project ~/work/api --project ~/oss/api`. With no `--project` the server serves the current
directory. `--port` defaults to `8787`. One server means one URL and one WebSocket, however many
Projects it serves.

The browser opens on the Project picker, remembers the last Project you chose on that device, and
skips the picker when the server serves exactly one. `?project=<absolute path>` opens a Project
directly, so a bookmark or homescreen shortcut lands in the right repository. A healthy start prints
one `pi-my-ui: project <path>` line per Project, then the listening line:

```text
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

In production, Caddy serves `packages/client/dist` and reverse-proxies `/ws`, `/healthz` and
`/files/download` to the server. The [Caddy + Tailscale guide](docs/deploy/caddy.md) has the
Caddyfile. The page address names the Project to open, as `?project=<absolute path>`, and, within it,
the Session, as `?session=<id>`. A Session link also needs its Project: either `?project=` in the
same address, or a Project this device remembers, or a server that serves only one. The
[user guide](docs/guide.md#5-opening-a-session) explains how to get an id.

For client development, Vite serves the source and proxies the real backend:

```bash
# terminal 1: the backend
node packages/server/dist/cli.js --project /path/to/project --port 8787

# terminal 2: the client
npm exec --workspace @pi-my-ui/client -- vite dev
```

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

| Command                      | What it does                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify`             | **The fast gate.** Typecheck (tests included) → lint, hygiene, e2e style and fixture checks → format check → store and component tests → build. Stops before end-to-end. |
| `npm run verify:full`        | The fast gate plus the end-to-end suite (one process, eight workers).                                                                                                    |
| `npm run typecheck`          | Build the protocol package, then typecheck every workspace including tests                                                                                               |
| `npm run lint`               | ESLint, the comment hygiene, e2e style and fixture checks                                                                                                                |
| `npm run format`             | Prettier write                                                                                                                                                           |
| `npm run format:check`       | Prettier check (non-mutating)                                                                                                                                            |
| `npm run test`               | Store and component tests                                                                                                                                                |
| `npm run build`              | Build every workspace                                                                                                                                                    |
| `npm run test:e2e`           | The whole Playwright suite in one process, pinned to eight workers                                                                                                       |
| `npm run test:smoke`         | Opt-in: record one real-provider run and replay it through the scripted provider                                                                                         |
| `npm run measure:pool`       | Measure the pool's resident memory and eviction behaviour                                                                                                                |
| `npm run rerecord -- <name>` | Re-record one scripted-provider script from a real provider run                                                                                                          |

The browser commands need a build first (`npm run build`) and a one-time
`npx playwright install chromium`.

### What the gates cover

`npm run verify` stops after the build. `npm run verify:full` adds the end-to-end suite.

- **Typecheck** covers tests as well as source.
- **Lint** includes `scripts/hygiene-check.mjs`, which fails on a ticket id or a date in a source
  comment, and warns on a file over 400 code lines or a high comment ratio. It also includes
  `scripts/e2e-style-check.mjs`, which rejects raw theme colours in e2e specs.
- **Store and component tests** feed `ServerMessage` values straight into the client store and
  assert on rendered output. They never open a socket and never touch a store internal.
- **End-to-end tests** run a real browser against real pi, in a hermetic home per test, with the
  scripted provider as the only substitute for the model and the real bridge loaded. Reconnect and
  resync are exercised through a test-only hook that drops viewer connections.
- **Fixture check** refuses a committed raw or oversized pi Session file; only the curated,
  sanitised seeds under `packages/e2e/fixtures/seeds` are allowed.

The suite does not need model credentials. The opt-in smoke test is the only test that does:
`npm run test:smoke` skips loudly unless `ANTHROPIC_API_KEY` (or the chosen provider's variable) is
set, and it never runs as part of either gate.

## Documentation

- [User guide](docs/guide.md) — every screen and control, from the phone's point of view.
- [Troubleshooting](docs/troubleshooting.md) — what you see, why, and what to do.
- [Caddy + Tailscale](docs/deploy/caddy.md) — the phone address, TLS, the origin allowlist.
- [Running as a service](docs/deploy/service.md) — systemd and launchd units, logs and restarts.
- [Architecture decisions](docs/adr/) — the choices and their costs.
- [Measurements](docs/measurements.md) — the numbers the pool defaults come from.
- [Glossary](GLOSSARY.md) — Session, Pi child, Projection, Snapshot, Delta, Cursor, Leaf, Bridge,
  Subagent.

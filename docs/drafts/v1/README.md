# pi-my-ui

A mobile web UI for [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent): the phone
talks to a local server, the server drives `pi --mode rpc` child processes. See
[`docs/project/README.md`](docs/project/README.md) for the board and
[`docs/adr/`](docs/adr/) for the architecture decisions.

This repository is an npm workspaces monorepo: the packages type-check, lint, test, and build behind a
single `npm run verify`. The server is a Hono app whose whole HTTP surface is `GET /healthz`,
`POST /files/download` and the `/ws` WebSocket route (it drives `pi --mode rpc` children and serves
**no UI** — [ADR 0021](docs/adr/0021-file-tree-listing-and-download-transport.md)); the client is the
Svelte 5 phone UI; and the `pi-my-ui` launcher (E1-T2) starts the server and shuts it down cleanly.
Serving the client in production is Caddy's job ([`docs/deploy/caddy.md`](docs/deploy/caddy.md)) —
see [Run it locally](#run-it-locally) for how to reach the real backend from a browser.

## Requirements

- **Node.js `>=22.22.2`** (declared in root `package.json` `engines`). Developed and verified on
  `v26.9.0`. The floor is set by the toolchain: Vitest 5 requires `^22.12.0 || ^24.0.0 || >=26.0.0`
  and jsdom 30 requires `^22.22.2 || ^24.15.0 || >=26.0.0`.
- npm (workspaces). Verified with `npm 12.0.2`.
- `pi` on `PATH` for the bridge-extension smoke test only (`pi --help` is authoritative for its CLI).
  The test skips loudly when `pi` is not runnable.

## Layout

```
packages/
  server/             Node/TS: Hono HTTP app + `ws` stub, builds to dist/ with tsc
  client/             Svelte 5 + Vite + Tailwind SPA, builds to dist/ with vite
  bridge-extension/   pi extension loaded into each RPC child with `pi -e <built path>`
docs/                 ADRs, project board, epics, tickets
```

## Commands (from the repository root)

| Command                | What it does                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`               | Install the exact locked dependency tree.                                                                                                                          |
| `npm run verify`       | **The gate.** typecheck (tests included) → lint → style check → format check → unit/integration tests → build → ADR index check (see below).                       |
| `npm run test:e2e`     | Browser end-to-end (Playwright, phone viewport) against the test-mode server + fake RPC child. Needs `npx playwright install chromium` once; not part of `verify`. |
| `npm run typecheck`    | Type-check every workspace against the shared strict base (tests included).                                                                                        |
| `npm run lint`         | ESLint over the repository.                                                                                                                                        |
| `npm run style:check`  | The mechanically checkable `code-style` rules (package-root imports, barrels, Svelte 5 syntax, handshake-version literals, conflict markers).                      |
| `npm run test`         | Run the Vitest suites (server, client, bridge-extension).                                                                                                          |
| `npm run build`        | Build every workspace (`tsc` for server/bridge, `vite build` for client).                                                                                          |
| `npm run mock`         | Serve the built client plus a scripted mock backend from one process (dev/demo; E2-T4a).                                                                           |
| `npm run docs:check`   | Verify `docs/README.md` indexes every ADR, all links resolve, all have a `Status:`.                                                                                |
| `npm run format:check` | Prettier check (non-mutating).                                                                                                                                     |
| `npm run format`       | Prettier write.                                                                                                                                                    |

`npm run verify` is the command every ticket cites; run it before asking for review. It composes the
per-workspace scripts (`scripts/verify.mjs`) in order, stops at the first failure, and prints the failing
step's label. It never duplicates a workspace's config. The last step, `docs:check`, guards the ADR index
against silent rot (a missing link, a dangling link, or a missing `Status:` line).

`npm run test:e2e` runs the specs in `e2e/` through `scripts/test-e2e.mjs`, against a test-mode server
that serves the built client and spawns the fake RPC child — never the real `pi`, never your `~/.pi`.
Build once (`npm run build`) and install Chromium once (`npx playwright install chromium`) first; a
missing browser or missing build is reported loudly, never treated as a pass. It is deliberately **not**
part of `npm run verify`, which must pass on a machine with no browser.

### Run it locally

The **server serves no UI**, by design: its HTTP surface is `GET /healthz`, `POST /files/download` and
the `/ws` WebSocket route, so the `local:` URL the launcher prints is a **backend** URL — open it in a
browser and you get a 404 (ADR 0021). Three things can serve the client: **Caddy** in production
([`docs/deploy/caddy.md`](docs/deploy/caddy.md)), the **mock** for tests/demos, and the **Vite dev
server** for local development with the real backend.

```bash
npm run build                                  # server, client, protocol, bridge extension

# terminal 1 — the real backend (prints `local:`, a backend URL)
node packages/server/dist/index.js --cwd /path/to/project --port 8787 --keep-alive

# terminal 2 — the client; Vite serves it and forwards /ws, /healthz and /files/download
npx --workspace @pi-my-ui/client vite dev      # open the URL Vite prints (http://localhost:5173/)
```

The dev proxy (`packages/client/vite.config.ts`) targets `http://127.0.0.1:8787` by default — the
launcher's default `--port`. A backend on another port needs no config change, just point the proxy at
it:

```bash
PI_MY_UI_BACKEND_ORIGIN=http://127.0.0.1:9999 npx --workspace @pi-my-ui/client vite dev
```

Three things to know about that recipe:

- It is **dev-only**. `server.proxy` is a `vite dev` setting; nothing about it reaches `vite build`, and
  the client source is unchanged (it opens its socket on the page origin, so the Vite origin works as-is).
- It forwards **exactly** those three paths. A new server route must be added to the proxy too — the same
  maintenance trap the Caddyfile matcher carries (ADR 0021).
- A browser origin on `localhost` or `127.0.0.1` is loopback, which the server's origin/host policy
  accepts when **no** `--allowed-origin` is configured; the dev proxy forwards the browser's own
  `Origin` unchanged, so the default works as printed. If you _do_ pass `--allowed-origin` (for the
  phone, say), add the origin you actually open the dev server at
  (`--allowed-origin http://localhost:5173`) or the WebSocket upgrade is refused — `localhost` and
  `127.0.0.1` are different origins to that check.

One process, no browser-to-real-`pi` hop: the mock serves a client and a scripted backend together.

```bash
npm run mock
```

### First launch (`pi-my-ui`)

The `pi-my-ui` launcher (E1-T2) starts the server and prints its URLs:

```bash
pi-my-ui --help          # flags: --cwd, --port, --idle-timeout, --keep-alive, --host, --allowed-origin
pi-my-ui                 # start the server; prints the reachable backend URL(s)
```

It prints two things worth reading together: the `local:`/`phone:` URLs, which are **backend** URLs, and
a `ui:` line naming what actually serves the client (Caddy in production, the mock in tests, or the Vite
dev server — [Run it locally](#run-it-locally)). `--help` output, those lines, and a clean SIGINT
shutdown that leaves no child processes are E1-T2's definition of done.

## TypeScript configuration

`tsconfig.base.json` holds the shared strict options (`strict: true` plus stricter companions).
Each package has a `tsconfig.json` that **extends the base and includes its tests as well as its
source**, and server/bridge add a `tsconfig.build.json` that narrows `include` to `src` and emits to
`dist/`. `npm run typecheck` covers tests; that is a deliberate project rule, not an accident.

## Lint/format toolchain

ESLint 10 (flat config, `eslint.config.js`) with `typescript-eslint` and `eslint-plugin-svelte`, plus
Prettier 3 with `prettier-plugin-svelte`. `eslint-config-prettier` is applied last so the two never
disagree. Biome was considered and rejected: its Svelte checker reports template-only rune usage as
unused.

## The `pi` extension contract

`packages/bridge-extension` compiles to an ESM default-export factory that `pi -e <built path>` loads
(contract read from the installed
`@earendil-works/pi-coding-agent/docs/extensions.md`). Its smoke test spawns a real
`pi --mode rpc` child with a temp `HOME`, asserts the single `session_start` stderr line, asserts no
`Failed to load extension` on stderr, then closes stdin and requires exit code `0`.

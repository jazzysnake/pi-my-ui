# pi-my-ui — user guide

`pi-my-ui` is a web app you run on your laptop that lets you drive
[`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (the AI coding agent) from your
phone's browser. The laptop runs one small server next to `pi`; you open the page over
Caddy + Tailscale (a private network between your own devices) and chat.

If you read only one thing: **start the server on the laptop, open its address on the phone, and talk
to the agent.** Everything else — sessions, the sidebar, `/tree`, files, subagents — is built on top
of that one loop.

This guide is written against the code as it stands today. Where something has not been confirmed on a
real phone, it says so — see [What has and has not been confirmed on a real phone](#what-has-and-has-not-been-confirmed-on-a-real-phone).

---

## 1. What the app is

- **A phone-shaped chat UI for `pi`.** The interface targets a phone viewport; it is not designed for
  a desktop browser (a wide window will still render, but it is not the design target).
- **Your laptop does the work.** A server on the laptop owns the sessions; each session is one `pi`
  process. The phone is a thin client over a WebSocket.
- **Sessions keep running in the background.** Start a long task in one session, switch to another,
  and the first keeps working. (Why: [ADR 0002](adr/0002-parallel-sessions-process-pool.md) — optional
  reading, not required.)
- **There is no login.** Reachability comes from Tailscale plus an origin allowlist, not from a
  password. (Why: [ADR 0013](adr/0013-exposure-and-security.md).)

## 2. What you need first

On the **laptop**:

1. **Node.js** `>=22.22.2` and **npm**.
2. **`pi` installed and authenticated** as the user who will run the server (see
   [Troubleshooting](#8-troubleshooting), "pi is not authenticated").
3. **Caddy** installed, and the repository reachable from the phone over **Caddy + Tailscale**. The
   exact Caddyfile, the Tailscale steps, and the `--allowed-origin` value are in the
   [Caddy + Tailscale guide](deploy/caddy.md); it is not repeated here.

On the **phone**:

4. The **Tailscale** app, signed in to the same tailnet as the laptop, showing "Connected".

## 3. Install

From the repository folder on the laptop (copy–paste; you do not need to edit anything):

```bash
npm ci
npm run build
```

This produces the server (`packages/server/dist/index.js`) and the phone client
(`packages/client/dist`). The names in the commands below assume you are in the repository folder.

## 4. First launch

Start one server for the project you want to work in:

```bash
node packages/server/dist/index.js --cwd /path/to/project --port 8787
```

- `--cwd` is the project folder that server owns. Its sessions and its files are the only ones it
  serves. It defaults to the folder you run the command from.
- `--port` defaults to `8787`. Use a different port for each project (see
  [Running several projects](#7-running-several-projects)).

A healthy start prints lines like these:

```text
[pi-my-ui] cwd: /path/to/project
[pi-my-ui] local: http://127.0.0.1:8787
[pi-my-ui] ui: nothing is served here (ADR 0021) — the client comes from Caddy in production ...
```

The `local:` URL is for the **laptop** only, and it is a **backend** URL: opening it in a browser gives
a 404 on purpose, because the server serves no pages. The phone UI comes from **Caddy**, which serves
the built client and forwards the app's routes to this server.

To stop the server, press `Ctrl-C`. It shuts down cleanly and stops the `pi` sessions it started.

## 5. Open it on the phone

1. Open the Tailscale app on the phone and confirm it says Connected.
2. Open `https://<your-tailnet-name>` in the phone's browser (the name you set up in the
   [Caddy + Tailscale guide](deploy/caddy.md)).
3. The page loads and the **connection dot** in the top bar goes from **Connecting** to **Connected**.
   The dot is coloured; tap it (or hover on a computer) to show its text.

If the page loads but the dot never reaches Connected, the reason is on the laptop's terminal — the
server refuses a connection whose origin is not allowed, and logs the origin the browser sent. See
[Troubleshooting](#8-troubleshooting).

## 6. The screen, region by region

From top to bottom, the phone shows:

- **Top bar** — the `☰` sidebar toggle, the wordmark `pi-my-ui`, then, at the right, the connection
  dot and the **Files** button.
- **Session bar** — `Session <state>` for the open session, the **context-usage readout**
  (right-aligned), and a **Reconnect** button when the session's process is gone (see
  [Troubleshooting](#8-troubleshooting)).
- **Agent pill** — a one-line subagent control: `main`, or a focused subagent's `@handle`, or
  `main · subagents limited`. Shown only when there is something to open.
- **Transcript** — the conversation: your messages, the assistant's streaming replies, tool-call
  cards, collapsed reasoning, and notifications. This is the one scrolling area.
- **Composer** — the status strip (model, thinking level, auto-compact), then the input row:
  `[input] [attach] [branch] [send]` (or `[stop]` while a run is active), and the composer's error
  line when something is refused.

### The sidebar (sessions)

Tap `☰` to open the session drawer. It is collapsed by default.

- It lists the sessions of the **one project this server owns**, each row showing the session's name
  (or the first line of your first message) and how long ago it was last active, plus a dot while the
  session is working or has unread output.
- **Tap a row** to switch to that session. Switching only changes what you are looking at; the other
  session keeps running.
- The **`+`** starts a new session.
- There is **no rename and no delete** — deliberately; sessions are the files `pi` writes, and the UI
  does not manage them.

### The composer (talking to the agent)

- Type a message and tap **send** (the round `↑` control). While the agent is working, that same
  control is a **stop** (`■`) that cancels the run.
- **Enter inserts a newline.** To send from the keyboard, press **`Ctrl`+`Enter`** (or
  **`Cmd`+`Enter`** on a Mac-style keyboard).
- **`Escape` cancels a running turn.** (If the command palette is open, the first `Escape` only closes
  the palette; press it again to cancel.)
- **The control order is `[input] [attach] [branch] [send|stop]`** — send/stop is the rightmost
  control, in the thumb's corner; the branch control is immediately to its left.
- **Attachments** are images: tap the paperclip `📎`, choose an image, and it appears as a thumbnail
  you can remove with the `×`. Send it with your message.
- **While a run is active**, a "While running" row appears with a **Steer** / **Follow up** chooser,
  a one-line caption explaining both, and its own **Send**. *Steer* (the default) feeds your message
  into the run at its next step; *Follow up* waits until the run finishes. Type in the box, pick one,
  tap Send.

The status strip above the input (when a session is open) shows the **model** and the **thinking
level** — each a button that opens a picker — and the **Auto-compact** toggle. Those need no typing.

### Slash commands and the palette

Type **`/`** to open the command palette (the app's built-in commands plus any prompt templates the
server knows). It fuzzy-filters as you type. **Choosing a row inserts the command into the composer —
it does not run it.** A tap, `Enter`, and `Tab` all complete the highlighted row; nothing is sent
until you press send. This is deliberate: commands that take arguments (like `/name` or
`/compact`) need you to type those arguments first.

The built-in commands are:

| Command       | What it does                                              |
| ------------- | --------------------------------------------------------- |
| `/tree`       | Open the message tree and switch branches                 |
| `/compact`    | Compact the conversation, optionally with instructions    |
| `/model`      | Choose the model for this session                         |
| `/thinking`   | Set the thinking level for this session                   |
| `/new`        | Start a new session                                        |
| `/resume`     | Open the session list                                      |
| `/fork`       | Fork from a previous message                               |
| `/clone`      | Clone this session's active branch                         |
| `/name`       | Set this session's display name                            |
| `/session`    | Show this session's statistics                             |
| `/export`     | Export the session as HTML                                 |

Anything else that starts with `/` is sent to the agent as written, **except** `pi`'s own TUI-only
commands (`/settings`, `/hotkeys`, `/login`, `/logout`, `/llama`, `/scoped-models`, `/theme`,
`/trust`, `/reload`, `/changelog`, `/quit`, `/share`, `/bug`, `/copy`). Those exist only in `pi`'s
terminal interface and are **refused** here rather than silently sent to the model as text.

### `/tree` — the message tree

Open it by typing `/tree` or by tapping the composer's **branch** control (`⑂`) — both open the same
modal.

- On open, only the active path is expanded; **alternative branches are collapsed**, each showing how
  many messages it holds. Expand one to look.
- **Search** (the field at the top) filters to matching messages; picking a result expands to it and
  highlights it.
- **Selecting a message makes it the active point of the conversation** (the branch switches, and the
  transcript follows the new path — the old branch is still in the tree). If the message is one of
  **yours**, its text comes back into the composer so you can edit and resend it.

### Bash mode: `!` and `!!`

Start a message with `!` or `!!` to run a shell command from the composer. An indicator appears
**before you send**, saying which mode you are in:

- **`!` — "adds to context":** the command's output enters the model's context on your next message.
- **`!!` — "not added to context":** the output is shown to you but never enters the model's context.

### Subagents

If `pi` is running subagents (through the `@tintinweb/pi-subagents` extension), the **agent pill**
appears.

- The pill reads **`main`** when the main conversation is focused, or the focused subagent's
  **`@handle`** (plus a `+N` when other agents are also active) when you are inside a subagent.
- **Tap the pill** to open the agent list: a `main` row plus one row per agent with its type, name,
  status, and elapsed time. **Tap a row** to focus that agent.
- While a **live** subagent is focused, plain text you send goes to that subagent (the pill names it,
  so the composer does not repeat it). You can steer only a **running** agent; a settled or queued
  agent shows why sending is disabled instead of silently doing nothing.
- A subagent's own conversation has **no separate header bar** — the pill is how you know where you
  are and how you get back: open the pill and choose `main`. (In the limited subagent mode below, the
  composer also shows a `Replying to @handle` chip, because there the pill does not name the agent.)
- **Workflow runs** (a run that owns its agents) appear in the list as their own row, but their
  agents' transcripts are not available.
- **A settled run's conversation stays openable.** Focusing a completed agent this browser holds no
  live transcript for reads the run's **own session file** from disk and shows it in the same
  transcript view. When no such file exists the region says the conversation is no longer available;
  when one is found but cannot be read — or two runs' ids collide — it says why instead, and never
  shows a different run's conversation. The run is matched by the first **8 hex characters** of its
  id, the naming `pi-subagents` gives its session files (a convention `pi` does not guarantee), so
  this can only ever **fail to find** a conversation, never open the wrong one.

### Files

Tap the **Files** button (`🗀`) in the top bar. It opens a read-only file tree, rooted at the open
session's working directory (the `--cwd` you started the server with).

- **Directories** expand on tap, loading their contents on demand.
- **Tap a file** to download it to the phone. Text-like files also get a **Preview** button that shows
  their contents inline (bounded, and it will say if it was truncated).
- There is **no editing** — the tree is read-only, and downloads are the only way files leave the
  laptop.

## 7. Running several projects

`pi-my-ui` is **one server per project folder, one port each** ([ADR 0003](adr/0003-one-server-per-cwd.md)).
Sessions and files never mix between projects. To run two projects, start two servers with different
`--cwd` and `--port`:

```bash
node packages/server/dist/index.js --cwd /path/to/project-a --port 8787
node packages/server/dist/index.js --cwd /path/to/project-b --port 8788
```

Each project also needs its own **phone address** (its own Caddy site on its own port), and the port is
part of the origin, so each gets its own `--allowed-origin`. The exact Caddyfile for a second project
is in the [Caddy + Tailscale guide](deploy/caddy.md). In the phone's browser, use one tab per project.

To keep a server running across reboots and logouts, run it as a service — the unit files for systemd
(Linux) and launchd (macOS) are in the [service guide](deploy/service.md).

### Launcher flags (the full list)

These are the only command-line flags, in the order `--help` prints them:

| Flag                          | Meaning                                                                                  | Default                    |
| ----------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| `--cwd <dir>`                 | Working directory the server is scoped to (its sessions and files)                        | the current directory      |
| `--port <port>`               | TCP port to listen on                                                                     | `8787`                     |
| `--host <address>`            | Address to bind                                                                           | `127.0.0.1` (loopback only) |
| `--idle-timeout <seconds>`    | Evict an idle, unwatched session's process after this long                                | `300`                       |
| `--keep-alive`                | Disable idle eviction entirely                                                            | off                         |
| `--allowed-origin <origin>`   | Browser origin allowed to connect; **repeatable**; required when binding beyond loopback  | none                        |
| `-h`, `--help`                | Print usage and exit                                                                      | —                           |

Run `node packages/server/dist/index.js --help` any time to see this list.

## 8. Troubleshooting

Each entry is **what you see → why → what to do**.

### A session shows an error after its process crashed

- **You see:** the session bar reads **Session error**, and the transcript shows an **Error** row with
  the process's exit details (for example "the session's child process exited (code 1, signal none)").
  A **Reconnect** button appears in the session bar, and a **Resume** button on the error row.
- **Why:** the `pi` process for that one session exited unexpectedly. The session **file** is intact,
  so the conversation is not lost.
- **Do:** tap **Reconnect** (or **Resume**). The server starts a fresh `pi` process from the session
  file; the transcript and completed turns are still there. If it keeps happening, look at the
  laptop's server output for why `pi` is exiting (a crashed `pi`, an out-of-memory kill, or a missing
  dependency).

### A session says "Starting…" right after you open it

- **You see:** the session bar reads **Session Starting…** for a moment.
- **Why:** this is **expected**, not an error. A session whose process had been stopped is being
  started again from its session file. `pi-my-ui` stops an idle, unwatched session's process after
  `--idle-timeout` seconds (default `300`) to free memory
  ([ADR 0014](adr/0014-idle-eviction-policy.md)); opening it again respawns it. From your side that
  wait is the same whether the session was idle-evicted or the server was restarted.
- **Do:** nothing — wait a moment. The transcript is preserved. To stop sessions being evicted at all,
  start the server with `--keep-alive`.

### The page loads but never connects (origin rejected)

- **You see:** the page is served, but the connection dot stays **Connecting**/**Reconnecting**, no
  sessions appear, and the browser console shows a WebSocket handshake failing with **403**.
- **Why:** the address you opened on the phone is not the one the server allows. The server checks the
  browser's `Origin` against `--allowed-origin`, exactly (scheme, host, and port).
- **Do:** look at the server's output on the laptop: it logs one line per refusal, quoting the origin
  the browser actually sent. Compare it character-for-character with your `--allowed-origin` value and
  make them identical — including `https://` vs `http://`, and the port if it is not the default. Full
  detail: [Caddy + Tailscale guide, “what the origin is wrong looks like”](deploy/caddy.md).

### Caddy returns 502, or the app talks to the wrong port

- **You see:** the browser gets a **502** from Caddy (the page may still load if the client was cached).
- **Why:** the server is not running, or Caddy is proxying to a port no server is listening on.
- **Do:** check the server directly: `curl -sS http://127.0.0.1:<port>/healthz` (it should answer
  `{"status":"ok","service":"pi-my-ui-server"}`). Then make sure Caddy's `reverse_proxy` upstream
  matches the server's `--port`. Detail: [Caddy + Tailscale guide](deploy/caddy.md).

### `pi` is not authenticated on the laptop

- **You see:** a session fails to do useful work — its process exits (so the session shows an error,
  see above), or a turn comes back with an authentication error from `pi`.
- **Why:** the `pi` on the laptop has no working credentials for the user that runs the server.
- **Do:** on the laptop, run `pi` in a terminal **as the same user that runs `pi-my-ui`** and complete
  its login there; then tap **Reconnect** on the session. `pi` stores its credentials under `~/.pi`,
  and the server's `pi` processes use the same account. (The exact on-screen wording of an auth error
  depends on `pi`; the fix is to authenticate in a terminal first.)

### A project's `.pi` configuration "does nothing" through the UI (project trust)

- **You see:** no dialog — the app just behaves as if a project's own `.pi` settings, MCP servers,
  extensions, skills, prompts, themes, or `SYSTEM.md` were not there.
- **Why:** `pi` shows a **trust prompt** before loading a folder's `.pi` resources, and that prompt
  **cannot be shown in RPC mode** (the mode this server uses). With no saved decision, `pi` skips those
  protected resources. This affects only the process's working directory — in this deployment, the
  `--cwd` you started the server with.
- **Do:** **the trust decision is yours, per directory, and it is made outside this app.** Either run
  `pi` once in that project folder in a terminal and record the decision there (save it so future
  processes reuse it), or set `defaultProjectTrust` in `~/.pi/agent/settings.json`, or move the shared
  configuration to your user-level `~/.pi`. There is **no in-app trust dialog** — nothing in the phone
  UI asks you. Detail: [Caddy + Tailscale guide, "Project trust"](deploy/caddy.md).

### Subagents are limited (the bridge is unavailable)

- **You see:** the agent pill reads **`main · subagents limited`**. Opening it lists the session's
  **completed** subagent runs with a note that live updates need the bridge extension, and a focused
  subagent has no live transcript.
- **Why:** the bridge extension (which streams live subagent state) is not loaded in that session. Core
  chat, sessions, `/tree`, and files are unaffected
  ([ADR 0008](adr/0008-graceful-degradation-without-bridge.md)).
- **Do:** for the core app, nothing — it degrades honestly. To get live subagents, make sure the
  `@tintinweb/pi-subagents` extension is installed and enabled for that session. Messages sent to a
  subagent with `@handle` are still delivered even in this mode.

### "The port is already in use"

- **You see:** the launcher exits immediately with a message like:

  ```text
  pi-my-ui: could not bind "127.0.0.1":8787: the port is already in use; change --port (EADDRINUSE)
  ```

- **Why:** another server (a second project, or another app) already has that port.
- **Do:** start this server on a different `--port`, and update the Caddy `reverse_proxy` upstream to
  match. To find what is using a port on Linux: `ss -ltn`; on macOS: `lsof -nP -iTCP -sTCP:LISTEN`. The
  service guide's "[What happens when the port is taken](deploy/service.md)" has the details.

## 9. What this app does **not** do

So the missing features do not surprise you — these are deliberate, not bugs
([ADR 0000](adr/0000-project-scope-and-non-goals.md)):

- **No login or accounts.** There is no authentication in the UI. Access is controlled by Tailscale
  reachability and the origin allowlist.
- **No offline use and no "install to home screen" (PWA).** It needs the laptop and the network.
- **No desktop-first layout.** The UI targets the phone; a wide screen is not the design target.
- **No editing files in the browser.** The file tree is read-only; you can download.
- **No voice input** (deferred).
- **No `pi` TUI-only commands** (`/settings`, `/login`, `/theme`, …) — they are refused, not faked.
- **No cross-session notifications or toasts.**

## 10. Why it works this way (optional reading)

The surprising parts have a reason, recorded in the project's decision records. These are optional
background, not prerequisites:

- **One `pi` process per session; sessions run in parallel** — [ADR 0002](adr/0002-parallel-sessions-process-pool.md).
- **One server per project folder, one port each** — [ADR 0003](adr/0003-one-server-per-cwd.md).
- **No authentication; origin allowlist instead** — [ADR 0013](adr/0013-exposure-and-security.md).
- **Idle sessions are evicted to bound memory** — [ADR 0014](adr/0014-idle-eviction-policy.md).
- **Subagents degrade gracefully without their bridge** — [ADR 0008](adr/0008-graceful-degradation-without-bridge.md).
- **Bash `!` vs `!!` semantics** — [ADR 0011](adr/0011-bash-command-semantics.md).
- **The visual design (palette, controls)** — [ADR 0017](adr/0017-ui-design-direction.md).
- **What is deliberately out of scope** — [ADR 0000](adr/0000-project-scope-and-non-goals.md).

The full list is in the [architecture decision records index](README.md).

## What has and has not been confirmed on a real phone

Be careful about two different kinds of "it works":

- **Confirmed by automated tests and by reading the code.** Everything this guide describes about the
  UI — the composer controls and keyboard, the palette, `/tree`, the sidebar, the session bar, the
  agent pill, files, the failure modes above — is covered by the project's browser tests at a phone
  viewport and by the code itself. (`npm run verify` and the Playwright suite.)
- **Not yet confirmed on a real device.** Behaviour that only a real phone over a real Tailscale +
  Caddy link can show — iOS keyboard occlusion and safe areas, real network latency, the TLS
  certificate the phone accepts, and the whole Caddy hop — is **not** asserted by this guide. That is
  the on-device acceptance checklist, which the **user** runs and records; it has **not been executed
  yet**. Until then, treat those items as unverified. The checklist is
  [E8-T1](project/polish-and-verification/on-device-acceptance/ticket.md).

If an on-device check fails, that is a real finding — file it rather than working around it.

## Where to read more

- **[Caddy + Tailscale deployment](deploy/caddy.md)** — the phone address, the origin allowlist, the
  certificate, and the failure modes for each.
- **[Running it as a service](deploy/service.md)** — systemd/launchd units, logs, restart, several
  projects.
- **[Project board](project/README.md)** — the status of every epic and ticket.
- **[Architecture decision records](README.md)** — the reasoning behind the design.

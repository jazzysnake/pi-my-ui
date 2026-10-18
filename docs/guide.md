# pi-my-ui — user guide

`pi-my-ui` is a web app you run on your laptop that lets you drive
[`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (the AI coding agent) from your
phone's browser. The laptop runs one small server next to pi; you open the page over Caddy plus
Tailscale and talk to the agent.

If you read only one thing: **start the server on the laptop, open the Session's address on the
phone, and talk to the agent.** Everything else — Sessions, the drawer, `/tree`, files, subagents —
is built on top of that one loop.

A quick map of the words: a **Session** is one pi conversation persisted as a file; a **Pi child**
is the `pi` process the server runs for one Session. The [glossary](../GLOSSARY.md) has the rest.

---

## 1. What the app is

- **A phone-shaped chat UI for pi.** The interface targets a phone viewport. A wide window still
  renders, but it is not the design target.
- **Your laptop does the work.** The server owns the Sessions and runs one `pi` process per Session.
  The phone is a thin client over a WebSocket.
- **Sessions keep running in the background.** Start a long task in one Session, switch to another,
  and the first keeps working. Closing the tab never stops a run.
- **There is no login.** Reachability comes from Tailscale plus an origin allowlist, not a password.

## 2. What you need first

On the **laptop**:

1. **Node.js >= 22.22.2** and npm.
2. **pi credentials** for the user that runs the server. pi stores them under `~/.pi`; run `pi` in
   a terminal once to log in (a global install is only needed for that). The server itself uses the
   pinned pi package from this repository, so it does not need `pi` on `PATH`.
3. **Caddy plus Tailscale**, set up as described in the [Caddy + Tailscale guide](deploy/caddy.md).
   That guide also produces the `--allowed-origin` value you need below.

On the **phone**:

4. The **Tailscale** app, signed in to the same tailnet as the laptop, showing Connected.

## 3. Install

From the repository folder on the laptop:

```bash
npm ci
npm run build
```

This produces the server (`packages/server/dist/cli.js`), the phone client
(`packages/client/dist`) and the bridge extension that every Pi child loads.

## 4. Start the server

Start one server for the Projects you want to work in:

```bash
node packages/server/dist/cli.js --project /path/to/project --port 8787
```

- `--project` names one Project the server serves: one absolute path, whose Sessions and files are
  the only ones served for that Project. Repeat the flag to serve several from one server. With no
  `--project` the server serves the folder you run the command from.
- `--port` defaults to `8787`. One server serves every Project, so the port does not change with
  them (see [Running several Projects](#14-running-several-projects)).
- Leave `--host` alone for the Caddy setup. The default is `127.0.0.1`, so only the local Caddy can
  reach the server.

A healthy start prints one `pi-my-ui: project` line per Project, then the listening line:

```text
pi-my-ui: project /path/to/project
pi-my-ui: listening on http://127.0.0.1:8787
```

The phone uses one address and one connection for every Project. The browser remembers the last
Project you chose on that device and shows the Project picker when it remembers none; a server that
serves exactly one Project skips the picker.

The `listening on` address is for the **laptop** only, and it is a **backend** address: opening it in
a browser gives a 404, because the server serves no pages. The phone UI comes from Caddy, which
serves the built client and forwards the app's routes to this server. A `bridge: listening on …`
line and one line per connected Pi child also appear on stderr.

To stop the server, press `Ctrl-C`. It shuts down cleanly and stops every `pi` process it started.

## 5. Opening a Session

The page address names a Project, as `?project=<absolute path>`, and optionally the Session to open
in it, as `?session=<id>`:

```text
https://laptop.tailnet-name.ts.net/?project=/home/you/projects/api&session=<session-id>
```

A Session link also needs its Project: either `?project=` in the same address, or a Project this
device remembers, or a server that serves only one. The id is the Session's own id, the one in its
file name under pi's session directory (`~/.pi/agent/sessions/--<project path>--/`). Keep that link
on the phone; it is the address you open. Choosing a Project or a Session rewrites the address to
name both, so a copied link lands in the same place.

Opening the bare address without `?project=` still connects: the picker opens when the server serves
several Projects and nothing is remembered, and the only served Project is chosen directly. Once a
Project is chosen the drawer lists its Sessions and its `+` starts a new one.

## 6. Open it on the phone

1. Open the Tailscale app on the phone and confirm it says Connected.
2. Open the Project address from [Opening a Session](#5-opening-a-session), or the bare address
   and pick a Project.
3. The page loads and the **connection dot** in the top bar goes from **Connecting** to
   **Connected**. The dot is coloured; tap it (or hover on a computer) to reveal its label.

If the page loads but the dot never reaches Connected, the reason is on the laptop's terminal: the
server refuses a connection whose origin is not allowed, and logs the origin the browser sent. See
[Troubleshooting](troubleshooting.md#the-page-loads-but-never-connects).

A dropped link reconnects on its own, with a growing delay capped at 15 seconds, and catches the page
up from where it was: missed output is replayed, or a fresh Snapshot is sent if the gap is too old to
replay. You never act on a reconnect.

## 7. The screen, region by region

From top to bottom:

- **Navigation bar** — the `☰` Sessions toggle, the wordmark `pi-my-ui`, the connection dot and the
  **Files** control at the right-hand end.
- **Session bar** — the **agent pill** at the leading edge (**main**, or the focused **@handle**, with
  **+N** while other agents are active), and the **context-usage readout** on the right. After a
  compaction the readout reads **Recalculating…** until pi has a new figure.
- **Transcript** — the conversation: your messages, the assistant's streaming replies, tool-call
  cards, collapsed reasoning, bash cards, notifications and compaction boundaries. This is the one
  scrolling area.
- **Run-state row** — appears under the transcript for a wait or a failure: **Starting…**,
  **Compacting context**, **Retrying** (with the attempt count), **Aborted**, **Error**, or
  **Pi child exited** with a **Reconnect** button. It disappears for an idle Session.
- **Composer** — the status strip (model, thinking level, auto-compact), then the input row:
  `[input] [attach] [branch] [send]`, or `[stop]` while a run is active, plus the composer's error
  line when something is refused.

### The transcript

- Your messages are shown as written. Assistant replies stream in and render markdown: headings,
  code blocks and tables, with wide blocks scrolling inside their own box rather than widening the
  page.
- **Thinking** blocks are collapsed; tap the summary to read the reasoning.
- **Tool-call cards** show the tool's name and **Running**, **Done** or **Failed**, with its output
  when there is one.
- **Bash cards** show the command, its output, its status (running, ok, error, aborted) and its exit
  code, plus which `!` mode it used.
- **Notifications** are collapsed; tap the summary to expand the payload.
- A **compaction boundary** reads **Context compacted here**, with the token count before it and a
  collapsible summary.
- The copy control on a message copies its raw markdown, so you can reuse it elsewhere.
- While output streams, the transcript follows the newest entry only if you are already at the
  bottom. If you scrolled up, it leaves your position alone. A resync keeps your scroll position.
- A very long transcript mounts only its newest 60 entries and says how many older messages are not
  shown, so a long Session stays responsive on a phone.

## 8. The Sessions drawer

Tap `☰` to open the Sessions drawer. It is collapsed by default.

- The drawer has two levels. The Sessions level names the **chosen Project** in its header and lists
  that Project's Sessions, most recently active first; its **Switch** control opens the Project
  list. Each row shows the Session's name, or the first line of its first message, and how long ago
  it was last active, plus a dot while the Session is working or has unread output.
- **Tap a row** to switch to that Session. Switching only changes what you are looking at; the other
  Session keeps running.
- The Project list is the first screen when nothing is remembered. Two Projects whose last folder
  name matches are told apart by their parent folders.
- The **`+`** starts a new Session in the chosen Project and opens it.
- There is **no rename and no delete** — deliberately. Sessions are the files pi writes, and the UI
  does not manage them.
- Opening a Session starts its Pi child lazily. Switching away keeps it alive, so switching back is
  immediate.

An idle Session you are not watching has its Pi child stopped after `--idle-timeout` seconds (120 by
default) to bound memory, and restarted from its Session file the next time you open it. That
restart shows **Starting…** for about a second, not an error. `--keep-alive` disables idle eviction
entirely.

## 9. The composer

- Type a message and tap **Send**. While the agent is working, that control is **Stop**, which
  cancels the run.
- **Enter inserts a newline.** Send from the keyboard with **`Ctrl`+`Enter`** (or **`Cmd`+`Enter`**).
- **`Escape` cancels a running turn.** If the command palette is open, the first `Escape` only closes
  the palette; press it again to cancel.
- **Attachments** are images: tap **Attach**, choose one or more images, and each appears as a
  thumbnail with its own remove control. Send them with your message.
- **While a run is active**, a **While running** row appears with **Steer** and **Follow up**, a
  caption explaining both, and its own **Send**. *Steer* feeds the message into the run at its next
  step; *Follow up* waits until the run finishes. Type in the box, choose one, tap Send.
- The **status strip** above the input shows the **model** and the **thinking level**, each a button
  that opens a picker; a tap anywhere else closes the open picker without changing the value. The
  strip also holds the **Auto-compact** toggle, which reads green while it is on. Every value shown
  is pi's own; a change you make is confirmed by pi reporting it back, so a refused change cannot
  look like it worked.
- When pi refuses a message, the composer keeps your text and images and shows an error line. Sending
  is disabled while the link is down.

### Bash mode: `!` and `!!`

Start a message with `!` or `!!` to run a shell command in the Session's Project. An
indicator appears **before you send**, saying which mode you are in:

- **`!` — "adds to context":** the output enters the model's context on your next message.
- **`!!` — "not added to context":** the output is shown to you but never enters the model's context.

The finished command appears as a card in the transcript and survives a resync. Output streams while
the command runs.

## 10. Slash commands and the palette

Type **`/`** to open the command palette. It fuzzy-filters as you type and lists the app's built-ins
plus pi's discoverable commands, such as prompt templates and commands from extensions. **Choosing a
row inserts the command into the composer — it does not run it.** A tap, `Enter` and `Tab` all
complete the highlighted row. This is deliberate: commands that take arguments need you to type
those arguments before sending.

| Command     | What it does                                           |
| ----------- | ------------------------------------------------------ |
| `/tree`     | Open the message tree and switch branches              |
| `/compact`  | Compact the conversation, optionally with instructions |
| `/model`    | Choose the model for this Session                      |
| `/thinking` | Set the thinking level for this Session                |
| `/new`      | Start a new Session                                    |
| `/resume`   | Open the Session drawer                                |
| `/fork`     | Fork from one of your previous messages                |
| `/clone`    | Copy this Session's active branch into a new Session   |
| `/name`     | Set or show this Session's display name                |
| `/session`  | Show this Session's statistics                         |
| `/export`   | Export the Session as HTML                             |

`/session` shows message and tool-call counts, tokens, cost and context usage. `/name` with no
argument shows the current name; `/name <text>` sets it. `/export` writes an HTML file and offers a
**Download** control for it. `/fork` opens a picker of your own messages; the fork is a new Session,
and the original is unchanged. `/clone` copies the active branch into a new Session. A created fork
or clone appears in the drawer.

Anything else that starts with `/` is sent to the agent as written, **except** pi's own TUI-only
commands (`/settings`, `/hotkeys`, `/login`, `/logout`, `/llama`, `/scoped-models`, `/theme`,
`/trust`, `/reload`, `/changelog`, `/quit`, `/share`, `/bug`, `/copy`). Those exist only in pi's
terminal interface and are **refused** here rather than silently sent to the model as text.

## 11. `/tree` — the message tree

Open it by typing `/tree` or by tapping the composer's **Branch** control. Both open the same modal.

- On open, only the branch points on the active path are expanded. **Alternative branches are
  collapsed**, each stating how many messages a tap will reveal. **One tap opens the whole run of a
  collapsed branch**: its head and the single continuations below it, down to the next fork or to the
  Leaf the Session came from. Forks inside that run and alternatives hanging off it stay collapsed,
  counted, and one tap away themselves.
- **Search** filters to matching messages; picking a result expands its ancestors, clears the search
  and highlights the message.
- **Selecting a message makes it the active point of the conversation** (the Leaf moves, the
  transcript follows the new path, and the old branch stays in the tree). If the message is one of
  **yours**, its text comes back into the composer so you can edit and resend it.
- A refused or unconfirmed move is shown as such, with the server's reason, and the modal stays open.

## 12. Subagents

Subagents appear when pi has the `@tintinweb/pi-subagents` extension installed for the Session. The
server never installs it for you, and it never pretends to have it: **when the extension is not
installed, the agent pill and the agent list are simply absent.**

- The **agent pill** reads **`main`** while the Session's own conversation is shown, or the focused
  subagent's **`@handle`**. Both carry **`+N`** when other agents are queued or running; a settled
  agent is not counted. The pill is absent while a Session has reported no agents.
- **Tap the pill** to open the agent list: a `main` row, then one row per agent with its type, name,
  status and elapsed time; a **workflow run** has its own row. Tap a row to focus that agent. Tap
  `main` to return to the Session's own conversation.
- A focused **live** subagent's conversation is streamed through the same transcript view, so reading
  it works exactly like reading the Session. A workflow run's row has no conversation to open.
- While a live subagent is focused, plain text you send is delivered to that subagent as a **steer**.
  Only a **running** agent can be steered: a settled one says steering is only available while it is
  running, and a queued one says steering starts once it is running. A steer in flight shows
  **Steering @handle — waiting for pi to deliver it** until pi confirms it.
- A **settled run's conversation stays openable.** Focusing a completed agent reads the run's **own
  session file** and shows it in the same view. When no such file exists the region says the
  conversation is no longer available; when one cannot be read it says why; when the run finished
  without writing a message it says so. Past runs are listed after a server restart too.
- A workflow run appears as its own row because it owns the agents it started; its agents'
  transcripts are not shown as one conversation.

Install the extension in pi the normal way if you want this surface:
`pi install npm:@tintinweb/pi-subagents`.

## 13. Files

Tap the **Files** control in the top bar. It opens a read-only file tree rooted at the **chosen
Project** — the folder you passed as `--project`, or the one you picked in the Project list, not the
open Session.

- **Directories** expand on tap and load their contents on demand.
- **Tap a file** to download it to the phone. Text-like files also get a **Preview** control that
  shows their contents inline, bounded to the first 64 KB, and says when it truncated.
- There is **no editing** — the tree is read-only, and downloads are the only way files leave the
  laptop. Paths outside the chosen Project are refused.
- The control is **disabled until a Project is chosen**, because with no Project there is no root to
  show. Choosing a different Project closes the panel rather than drawing one Project's files under
  another's name.

## 14. Running several Projects

`pi-my-ui` is **one server serving one or more Projects**: one port, one phone address, one
WebSocket. Sessions and files never mix between Projects — the drawer lists the chosen Project's
Sessions, and the file panel is rooted at it. Repeat `--project` at startup:

```bash
node packages/server/dist/cli.js \
  --project /path/to/project-a \
  --project /path/to/project-b \
  --port 8787
```

The flag order is the order the Project list uses. The same path may not be served twice, and one
served Project may not sit inside another; the server refuses startup and names the offending path.
To switch on the phone, open the drawer and tap **Switch**, or open a link carrying `?project=`. One
Caddy site and one `--allowed-origin` cover every Project, because the origin does not change with
the Project. The [Caddy + Tailscale guide](deploy/caddy.md) has the one-site setup.

To keep a server running across logouts and reboots, run it as a service: the systemd and launchd
units are in the [service guide](deploy/service.md).

### Launcher flags

These are the only command-line flags. `--help` prints the same list.

| Flag                        | Meaning                                                                     | Default               |
| --------------------------- | --------------------------------------------------------------------------- | --------------------- |
| `--project <dir>`           | Project to serve (its Sessions and files); repeatable                      | the current directory |
| `--port <port>`             | TCP port to listen on                                                       | `8787`                |
| `--host <address>`          | Address to bind; binding beyond loopback requires `--allowed-origin`         | `127.0.0.1`           |
| `--idle-timeout <seconds>`  | Evict an idle, unwatched Session's child after this long                    | `120`                 |
| `--keep-alive`              | Disable idle eviction entirely                                              | off                   |
| `--allowed-origin <origin>` | Browser origin allowed to connect; repeatable; a bare `scheme://host[:port]` | none                  |
| `-h`, `--help`              | Print usage and exit                                                        | —                     |

With no `--allowed-origin`, a browser on a loopback host (`localhost`, `127.0.0.1`) is accepted and
nothing else is. With an allowlist configured, every request must carry an origin in the list; the
match is exact after URL normalisation, so scheme, host and a non-default port all count.

## 15. What the app does not do

So the missing features do not surprise you — these are deliberate:

- **No login or accounts.** Access is controlled by Tailscale reachability and the origin allowlist.
- **No offline use and no install-to-home-screen.** It needs the laptop and the network.
- **No desktop-first layout.** The UI targets the phone.
- **No editing files in the browser.** The file tree is read-only.
- **No voice input.**
- **No pi TUI-only commands.** They are refused, not faked.
- **No cross-Session notifications or toasts.**

## 16. Where to read more

- [Troubleshooting](troubleshooting.md) — what you see, why, and what to do.
- [Caddy + Tailscale](deploy/caddy.md) — the phone address, TLS, the origin allowlist and its failure
  modes.
- [Running as a service](deploy/service.md) — systemd and launchd units, logs, restarts, several
  Projects.
- [Architecture decisions](adr/) — the reasoning behind the design.
- [Glossary](../GLOSSARY.md) — the project's vocabulary.

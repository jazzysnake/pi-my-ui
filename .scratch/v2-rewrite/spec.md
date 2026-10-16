Status: ready-for-agent

# pi-my-ui v2: rebuild with the right seams

Vocabulary is `GLOSSARY.md`. Decisions already recorded are `docs/adr/0001`–`0005`. Reference material copied from v1 as drafts, to be reworked and not trusted as written, is in `docs/drafts/v1/` (README, user guide, deploy guides, design variants). The v1 repo (`../pi-my-ui`) is a read-only reference for behaviour.

## Problem Statement

I drive `pi` from my phone through a local server. v1 does that, but I can no longer change it with confidence. Its tests are 36% larger than its source, one store class is 1,662 lines that every feature touches, and 40% of its code lines are comments, mostly history. Its mock server and its fake RPC child were separate re-implementations of pi that nothing kept equal to pi. They diverged, and one review mechanism that passed was inert against real pi. Every protocol change had to be made in two servers and survive a versioning scheme that only ever had one deployer. I want the same product on a structure where a change touches one place and a green test means the real thing works.

## Solution

Rebuild the product in this repo as v2, with full behaviour parity with v1 (epics E1–E8 of the v1 board and the v1 user guide) plus the six open v1 problems, reworked as fresh tickets rather than ported. Pi-facing behaviour is verified only against real pi, made deterministic by a scripted model provider. The client store consumes a plain stream of `ServerMessage`s; the WebSocket machinery sits behind it. A single reducer applies Deltas to a Projection on both server and client. The bridge is required. There is no protocol versioning, no fake of pi and no tests of internals.

## User Stories

### Starting and reaching the app
1. As the owner, I want to start one server for a project folder with a command and a port, so that its Sessions and files are the only ones served.
2. As the owner, I want the server to default to the current folder and port 8787, so that the common case needs no flags.
3. As the owner, I want the server to bind loopback only by default, so that nothing is exposed until I deliberately expose it.
4. As the owner, I want to set the bind address, idle timeout, keep-alive and one or more allowed origins by flag, so that I can deploy behind Caddy and Tailscale.
5. As the owner, I want `--help` to list every flag, so that I never need to read source.
6. As the owner, I want a clear one-line error when the port is taken, so that I know to change `--port`.
7. As the owner, I want Ctrl-C to shut the server down cleanly and stop every Pi child it started, so that no orphan processes remain.
8. As the owner, I want the server to print its URL and working directory on start, so that I know it is healthy.
9. As the owner, I want a health endpoint, so that I can check the server independently of the UI.
10. As the owner, I want to run several projects as several servers on different ports, with a browser tab per project, so that Sessions and files never mix.
11. As the owner, I want a connection from a foreign or missing origin to be refused and logged with the origin the browser sent, so that I can fix my allowlist.
12. As the owner, I want every client message validated at the boundary and rejected loudly when malformed, so that bad input is never coerced.
13. As the owner, I want the server to serve no UI itself, with the built client served by Caddy in production, so that the server stays a backend.
14. As the owner, I want a dev setup where the real backend is reachable from a browser, so that I can work on the client against real pi.
15. As the owner, I want guides for Caddy plus Tailscale deployment and for running as a service under systemd and launchd, so that I can keep it running across reboots.
16. As the owner, I want a user guide and troubleshooting guide, so that failures tell me what I see, why and what to do.

### Connection and resilience
17. As a phone user, I want a coloured connection dot in the top bar that shows Connecting, Connected or Reconnecting, and reveals its text on tap or hover, so that I always know the link state.
18. As a phone user, I want the browser to rejoin automatically after a drop, so that I never act on a reconnect.
19. As a phone user, I want to see the current Projection immediately on reconnect, so that I don't see a gap or stale state.
20. As a phone user, I want a missed stretch to be recovered by a Delta replay from my Cursor, or a fresh Snapshot if my Cursor is unknown, so that reconnecting is always safe.
21. As a phone user, I want long-running work to continue whether or not my browser is connected, so that closing the tab never stops a run.
22. As a phone user, I want a stuck or invalid server message to fail visibly and not render as success, so that I never trust a wrong state.

### Sessions and the sidebar
23. As a phone user, I want a collapsed-by-default drawer of this project's Sessions, so that the transcript gets the screen.
24. As a phone user, I want each row to show the Session name, or the first line of its first message, with how long ago it was active, so that I can recognise it.
25. As a phone user, I want a dot on a Session that is working or has unread output, so that I can see background activity.
26. As a phone user, I want tapping a row to switch the view without stopping the other Session, so that parallel Sessions keep running.
27. As a phone user, I want a plus control to start a new Session, so that I can begin fresh work.
28. As a phone user, I want a background Session's output to persist while I look at another, so that I lose nothing by switching.
29. As the owner, I want a Pi child started lazily when a Session is first opened and kept alive across view switches, so that opening is cheap and switching is instant.
30. As the owner, I want exactly one Pi child per Session file, so that two writers never touch one file.
31. As the owner, I want an idle, unwatched Pi child evicted after a configurable timeout and respawned transparently from the session file, so that memory stays bounded.
32. As the owner, I want idle eviction disabled by a flag, so that I can keep everything warm.
33. As a phone user, I want a Session that is starting to say so and not look like an error, so that respawn after eviction is not alarming.
34. As a phone user, I want a crashed Pi child to show the exit details in the transcript and a Reconnect/Resume control, so that I can recover from the intact session file.
35. As the owner, I want the Session list to be the files pi wrote, with no rename or delete in the UI, so that the UI does not manage what pi owns.
36. As the owner, I want pool footprint and eviction tuned against measured data, so that the defaults are justified.

### The transcript
37. As a phone user, I want my messages, assistant replies, tool-call cards, collapsed reasoning and notifications in one scrolling area, so that I can read the conversation.
38. As a phone user, I want streaming replies to appear as they arrive, so that I can follow the agent.
39. As a phone user, I want streaming thinking blocks to render and auto-scroll while they stream, so that I can watch reasoning live.
40. As a phone user, I want my scroll position preserved when the view resyncs, so that I'm not thrown back.
41. As a phone user, I want markdown headings, code blocks and tables rendered, with wide blocks that don't widen the page, so that long output is readable.
42. As a phone user, I want to copy a message's raw markdown, so that I can reuse it.
43. As a phone user, I want tool-call cards to show their running, success and error states, so that I know what the agent did.
44. As a phone user, I want run states for error, abort and retry (with attempt count) and in-progress compaction shown in the transcript, so that I understand what the agent is doing.
45. As a phone user, I want a compaction boundary entry in the transcript, so that I can see where history was condensed.
46. As a phone user, I want a very long transcript (hundreds of entries) to load quickly and scroll smoothly with a bounded number of mounted rows, so that a long Session stays usable on a phone.
47. As a phone user, I want streamed Deltas to update text without remounting rows, so that scrolling and selection stay stable.
48. As a phone user, I want a context-usage readout in the session bar that clears after compaction, so that I know how full the context is.

### The composer
49. As a phone user, I want an input row of input, attach, branch and send, with send in the thumb corner, so that the main action is easy to reach.
50. As a phone user, I want send to turn into stop during a run, so that I can cancel.
51. As a phone user, I want Enter to insert a newline and Ctrl/Cmd+Enter to send, so that I can write multi-line messages.
52. As a phone user, I want Escape to cancel a running turn, with the first Escape only closing the palette when it is open, so that the key does the expected thing.
53. As a phone user, I want to attach images with a paperclip, preview them as removable thumbnails and send them with my message, so that I can show the agent images.
54. As a phone user, I want a While running row with Steer and Follow up and a caption, so that I can redirect a run now or queue a message for its end.
55. As a phone user, I want a status strip with model and thinking-level pickers and an auto-compact toggle that round-trips, so that I can configure a Session without typing.
56. As a phone user, I want the composer to refuse a message and show an error line when pi refuses it, so that I know it wasn't sent.
57. As a phone user, I want a message that begins with `!` or `!!` to show which bash mode I'm in before I send, so that I know whether output enters context.
58. As a phone user, I want bash command output and exit codes shown in a card that survives a resync, so that results are not lost.
59. As a phone user, I want live bash output to stream while the command runs, so that I can watch it.
60. As a phone user, I want the composer to remain usable while the on-screen keyboard is open and after rotation, so that mobile quirks don't break typing.

### Slash commands and the palette
61. As a phone user, I want `/` to open a fuzzy-filtered palette of built-ins, prompt templates and server commands, so that I can find commands.
62. As a phone user, I want choosing a palette row to insert the command, not run it, so that I can type arguments first.
63. As a phone user, I want tap, Enter and Tab all to complete the highlighted row, so that any input method works.
64. As a phone user, I want `/tree`, `/compact`, `/model`, `/thinking`, `/new`, `/resume`, `/fork`, `/clone`, `/name`, `/session` and `/export` to route to their app behaviour, so that I have the commands I need.
65. As a phone user, I want pi's TUI-only commands refused with a message and not sent to the model, so that I'm never misled.
66. As a phone user, I want any other slash text sent to the agent as written, so that skills and templates work.
67. As a phone user, I want `/session` to show Session statistics, `/name` to rename and `/export` to download HTML, so that I can manage a Session's metadata.
68. As a phone user, I want `/fork` to create a new Session from a previous message while the original stays unchanged and both appear in the sidebar, so that I can explore alternatives.
69. As a phone user, I want `/clone` to copy the active branch to a new Session, so that I can continue independently.
70. As a phone user, I want `/compact`, from the palette or typed, to show an in-progress state and append a boundary, so that I can free context.

### The message tree and branches
71. As a phone user, I want `/tree` and the branch control to open the same modal, so that I have one mental model.
72. As a phone user, I want only the active path expanded with alternative branches collapsed and counted, so that big trees stay readable.
73. As a phone user, I want search that filters messages and expands and highlights the picked result, so that I can jump in a big tree.
74. As a phone user, I want selecting an entry to move the Leaf, switch the transcript to the new path and keep the old branch in the tree, so that nothing is destroyed.
75. As a phone user, I want selecting one of my own messages to put its text back in the composer, so that I can edit and resend it.
76. As a phone user, I want a refused or unconfirmed Leaf move shown as such and never as success, so that I can trust the tree.
77. As a phone user, I want a very deep tree to be navigable, so that long Sessions are not a trap.
78. As a phone user, I want to browse into an abandoned branch by tapping, including a branch head that is a single child off the active path, so that abandoned work is reachable and not only searchable. *(open v1 problem, in scope)*

### Subagents
79. As a phone user, I want an agent pill showing `main` or a focused subagent's `@handle` plus a count of other active agents, so that I know where I am.
80. As a phone user, I want the `+N` running-agent count shown on `main` as well, so that I see background work from the main view. *(open v1 problem, in scope; reverses a v1 decision and needs recording)*
81. As a phone user, I want to tap the pill to see main plus each agent's type, name, status and elapsed time and focus one, so that I can inspect it.
82. As a phone user, I want to steer a running subagent by typing while it is focused, with sending disabled and explained for settled or queued agents, so that I never send into the void.
83. As a phone user, I want a steer in flight shown in the status line until pi delivers it, so that I know it was received.
84. As a phone user, I want a live subagent's transcript streamed through the same transcript view, so that reading is consistent.
85. As a phone user, I want a settled run's conversation openable from its own session file, with a clear message when it is gone, unreadable or ambiguous and never a different run's conversation, so that history is reachable and honest.
86. As a phone user, I want a settled agent with an empty transcript to say the run finished, so that I'm not told "no messages yet".
87. As a phone user, I want past subagent runs listed after a server restart, so that restarts don't erase history.
88. As a phone user, I want workflow runs shown as their own row, so that grouped agents are understood.
89. As the owner, I want the subagent UI absent when the pi-subagents extension is not installed and an error when the bridge itself is unavailable, so that there is no half-working mode. *(ADR 0003)*

### Files
90. As a phone user, I want a read-only file tree of the Session's working directory opened from the top bar, so that I can see what the agent touched.
91. As a phone user, I want directories to expand on tap with contents loaded on demand, so that big trees stay fast.
92. As a phone user, I want to download a file to my phone and preview text-like files inline with truncation stated, so that I can read output without leaving the app.
93. As the owner, I want path traversal and reads outside the root rejected, so that the tree cannot leak the filesystem.

### Phone fit and design
94. As a phone user, I want every interactive control to meet a 44×44 minimum target in every state, so that taps land.
95. As a phone user, I want toasts and overlays that never swallow taps to controls beneath them, so that nothing blocks me.
96. As a phone user, I want drawers to contain their own scroll, no unintended horizontal scroll and reduced-motion respected, so that the page feels native.
97. As a phone user, I want the layout and visual design chosen in v1's UI direction, so that the product looks the same.

### Developer and maintainer
98. As a maintainer, I want `npm run verify` to run typecheck including tests, lint and format, store and component tests, build and sharded end-to-end tests against real pi, so that one command is the gate.
99. As a maintainer, I want the whole end-to-end suite to run in under a minute through sharding, with a gate that fails if any shard fails and accounts for every test, so that the gate is fast and honest. *(open v1 problem, in scope)*
100. As a maintainer, I want to re-record scripted-provider scripts from real provider runs with one command, so that scripts cannot drift into fiction.
101. As a maintainer, I want one opt-in smoke test against a real provider, so that I can check scripts still resemble reality.
102. As a maintainer, I want an exact pi version pinned and upgraded deliberately, so that pi changes never surprise the suite.
103. As a maintainer, I want fixtures built from trimmed, sanitised real sessions plus generated extreme shapes, so that tests use realistic data without leaking personal content.
104. As a maintainer, I want ticket IDs or dates in comments to fail the gate and oversize files and high comment ratios to warn, so that the v1 habits do not return.
105. As the owner, I want an on-device acceptance checklist I run on my phone over Tailscale and Caddy, and a Caddy bring-up I perform, so that the one unverified hop is verified. *(needs me)*

## Implementation Decisions

**Shape.** Six packages in one npm workspaces monorepo: a shared `protocol`, `server`, `client`, `bridge-extension`, a test-only `scripted-provider` (a pi extension) and an `e2e` harness with fixture builder. Stack unchanged from v1 (ADR 0004 of v1): strict TypeScript, Node, Hono plus `ws`, Svelte 5 with Vite and Tailwind, Vitest, Playwright.

**State model (carried).** The server is authoritative; the browser is stateless and rehydrates. The server subscribes to each Pi child continuously and holds a Projection per Session. A browser gets a Snapshot (Projection plus Cursor) then Deltas, and can request a resync from its Cursor. A single Delta reducer lives in `protocol` and is used by both ends, so a server Snapshot and a client replay cannot disagree.

**Process model (carried).** One server per working directory. A pool of `pi --mode rpc` children, one per Session file, started lazily with a server-generated id for new Sessions, kept alive across view switches, evicted by the idle rule. The server is the only writer of a Session file it owns.

**Protocol.** `protocol` defines the contract once: discriminants as constants with derived types, runtime validators for every inbound message that throw one typed error, and the cursor and Delta semantics. No version constant, no negotiation, no evolution rules (ADR 0004). A connection handshake remains only as far as the transport needs (identify the Session, set the Cursor).

**Bridge.** Required and loaded into every Pi child; failing to load or connect is a loud server error (ADR 0003). It is the only channel past pi's RPC: subagent lifecycle and transcripts, steering a specific subagent, and moving the Leaf to an existing entry. It never spawns, stops or consumes agents and never writes Session content. Pi-subagents absent means the subagent UI is absent. The v1 limited mode and its wording are removed.

**Client.** The store is split into slices by concern (transcript, composer, sessions, tree, subagents), all fed by one `ServerMessage` input. A transport module owns the WebSocket, handshake, reconnect and resync behind that input. No single class is touched by every feature.

**Seams (and the only substitutes).** Pi's RPC process boundary (real pi, no fake). Pi's model-provider boundary (scripted provider). The bridge socket (real). The client store's `ServerMessage` input. The transport's WebSocket (no fake). The clock (injected on the server, Playwright's clock in the browser). Only the model provider and the clock are substituted (ADR 0002, ADR 0005).

**Scripted provider.** Tests name a script, passed to pi by environment variable. Scripts are recorded replies shaped like session-file assistant turns, recorded from real provider runs with a re-record command. A prompt the script doesn't expect fails loudly and is never improvised. Subagents' model calls are served by the same provider.

**Hermetic harness.** Each test gets its own hermetic pi home, its own server, and its own port namespace. Pi is the pinned version, launched hermetically with the scripted provider and the bridge and the pi-subagents extension loaded as a real session would have them. The server exposes a test-only hook to drop viewer connections.

**Fixtures.** A fixture builder seeds real pi session files in the hermetic home. About five sessions from the owner's ges2t sessions (branching, compaction, subagent-heavy, large, plain) are trimmed and sanitised and the small results committed; raw sessions are never committed. A generator produces the extreme shapes (hundreds of entries, a very deep tree). The same sessions' assistant turns feed the scripted provider's recordings.

**Product decisions carried unchanged from v1** (as behaviour, not structure): session discovery and creation, built-in command routing, bash `!`/`!!` semantics, mobile layout and UI direction, exposure and security (loopback bind, origin allowlist, validate every message, bridge socket path never exposed, file tree rooted and traversal-proof), idle eviction, live bash output, file tree and download, subagent transcripts, in-session branch switching, forward pi output paths. These are re-derived structurally, not reopened.

**The open v1 problems** are in scope and are to be reworked as fresh tickets, not ported: an off-path single-child branch head with no tap target (story 78); the pill count shown on `main` (story 80, which reverses a recorded v1 decision and needs a new ADR); the sharded e2e gate (story 99); pool footprint and eviction tuning (story 36); and, requiring the owner, on-device acceptance and Caddy bring-up (story 105).

**Hygiene.** Comments say why, never history or restated code (`AGENTS.md`). The gate fails on ticket IDs or dates in comments. File size over 400 code lines and a high comment ratio are lint warnings, not failures.

**Docs.** v1's README, user guide, deploy guides and design variants are copied as drafts under `docs/drafts/v1/` and are reworked, not trusted. Known staleness: the guide's "subagents limited" mode contradicts ADR 0003.

## Testing Decisions

A good test asserts external behaviour through the highest seam and would still pass after an internal refactor. It never asserts on store internals, never hand-builds protocol ceremony, and never exercises a fake of pi.

**Two layers only (ADR 0005).**
1. End-to-end in a browser against real pi with the scripted provider and the real bridge. This is the acceptance suite and also covers the server through its public WebSocket, including reconnect and resync via the connection-drop hook.
2. Store and component tests feeding `ServerMessage` objects directly into the store and asserting on rendered output. Single messages are typed by the protocol. Multi-message flows (streaming, resync) use sequences captured from real-server runs.

**Acceptance.** The roughly 80 meaningful v1 end-to-end specs, ported to run on real pi: about 17 pure-UI specs (shell, viewport, header, toast, touch targets, markdown) carry over mostly as is; about 65 pi-dependent specs (streaming, thinking, bash, compaction, fork/clone, tree, session commands, sidebar and switching, tool cards, run states, files, subagents, steer, mobile polish, composer, palette, transcript performance) are re-driven by scripts and seeded sessions in place of mock scenarios. The one spec that only proves the v1 fake works is dropped. v1's unit tests are deleted, not ported.

**Prior art.** v1's Playwright specs and its real-pi seam spec (spawns real pi hermetically and round-trips a state request) are the closest prior art; v1's client tests that feed `ServerMessage` directly through a socket stand-in are the prior art for layer 2, minus the socket.

**Time.** Idle eviction and reconnect backoff are tested with an injected clock (server) and Playwright's clock (browser), never by waiting.

## Out of Scope

- Authentication or accounts of any kind.
- Offline use, install-to-home-screen, desktop-first layout, voice input, in-browser file editing, cross-session toasts.
- Any fake, mock or recorded replay of pi itself; a process-boundary fake may be added later only with a conformance check against real pi (ADR 0002).
- Protocol versioning or multi-version evolution (ADR 0004).
- A degraded no-bridge mode (ADR 0003).
- Porting v1 tickets or v1 unit tests as written.
- The on-device acceptance run and the Caddy installation themselves: tickets exist, the owner performs them.

## Further Notes

- The ges2t session store holds the richest real data (189 sessions); it lives in pi's session directory, not in that repo.
- `docs/orchestrator-state.md` in v1 records five instrument-versus-reality divergences and is the evidence behind ADR 0002.
- The user guide mentions v1's `--allowed-origin`, `--keep-alive` and similar flags; keep those flag names unless a ticket changes them deliberately.

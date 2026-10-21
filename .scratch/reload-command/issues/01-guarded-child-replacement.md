# 01: Reload replaces a Session's Pi child, guarded

**What to build:** A client can ask a Session to reload over the WebSocket and get a new Pi child on the same Session file, so every configuration file pi reads at startup is read again — settings, extensions, skills, prompt templates, themes, context files, `models.json`, providers, project trust and the default tool set. The replacement goes through the respawn path the server already uses for eviction, a crash and an explicit reconnect, so the one-child-per-Session rule is kept by that path rather than by a second one. The requester is then handed the reseeded Session: a fresh Snapshot with the same Session id, entries and Leaf, then the three supplements a viewer gets on attach — settings with the available models, commands and context usage — re-sent to every viewer of that Session, because each can differ with the new child and the palette and model picker are otherwise stale until the next attach. A Reloaded reply names the Session and carries no text, because the wording belongs to the client. On the requesting viewer's socket the order is Snapshot, then supplements, then the reply, so a client that acts on the reply is looking at the new state.

A reload is refused instead of destroying work when the Projection shows a turn that is streaming or retrying, a compaction in progress, a direct shell command whose block has no result yet, or a subagent whose status is queued or running. Refusals live server-side only, so one rule has one home and a second viewer cannot confuse it with a stale copy. Each refusal is the protocol's "the server refused a well-formed request" error carrying the reason: pi's own wording for the turn and the compaction, the command itself for a shell command, and a count for subagents.

A reload whose new child cannot start reports that start failure for that Session and leaves the Session able to answer a later request, because nothing died — a start that never happened is not an exit. That behaviour is inherited from the existing child-start path, so it invents no projection state and buys no test. The Bridge, the Snapshot/Delta/Cursor model, the transport's reconnect and resync, the eviction window and every other Session are untouched.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A Reload request naming a Session is accepted, and a Reloaded reply names the same Session; both validate like the other session commands
- [x] Reloading an idle Session replaces its Pi child with a new process on the same Session file, proved by the Snapshot that follows naming the same Session id with the same entries and Leaf
- [x] A skill written into the hermetic agent directory after attach is absent from the Commands a viewer already has, and present in the Commands sent after the reload
- [x] Settings (with the available models) and context usage are re-sent on every reload, to every viewer of that Session and not only to the requester
- [x] On the requesting viewer's socket the order is Snapshot, then supplements, then the Reloaded reply
- [x] A reload is refused with the reason in the error for each of: a turn streaming or retrying; a compaction in progress; a direct shell command with no result yet; a subagent queued or running
- [x] A refused reload replaces nothing, and a streaming turn still delivers its reply afterwards
- [x] A reload in one Session leaves another Session's child and Snapshot untouched
- [x] Backend specs cover the mechanism (a skill's freshness across the reload), each of the four refusals, the supplements reaching a second viewer, and the isolation from another Session

## Comments

Design: `../spec.md`. Decision record: `docs/adr/0011-reload-replaces-the-child.md`.

Implemented. The protocol pair is in `packages/protocol/src/{constants,messages,validate}.ts` and carries no text on the reply. The four refusals live in `packages/server/src/session-reload.ts`, read from the Projection before any child work and raised as `commandFailed`. `SessionHost.reload()` in `packages/server/src/session-host.ts` goes through the existing eviction/crash restart path, then `broadcastAttachSupplements` in `packages/server/src/session-attach.ts` re-sends settings, commands and context usage to every viewer through one reader; the handler in `packages/server/src/server.ts` answers only the requester, after the host resolves, which is what puts Reloaded third. `packages/e2e/backend/reload.spec.ts` covers the mechanism, all four refusals, the second viewer and the isolation from another Session; `multi-project-commands.spec.ts` gained `reload` in the bare-sessionId sweep.

No deliberate omission. The code review moved the fan-out onto the host's own broadcast (so `broadcastAttachSupplements` is gone, and `session-attach.ts` keeps only the reads), split the specs into `packages/e2e/backend/reload.spec.ts` for the mechanism, second viewer and isolation and `reload-refusals.spec.ts` for the four refusals over the shared `packages/e2e/src/reload-harness.ts`, and stated our own two refusal sentences in one shape (`subagents are still queued or running: <n>`, keeping the count the ticket asks for). pi's turn and compaction wording is verbatim.

Gate (`npm run verify:full`): typecheck, lint and format, and build passed; the store, component and backend step failed on the four pre-existing `ps`-dependent specs — `backend/launcher.spec.ts > SIGINT shuts down cleanly and stops the Pi children across every Project`, both `backend/pool-defaults.spec.ts` cases, and `backend/protocol-snapshot.spec.ts > a Projects request answers with the served Projects in order and starts no Pi child`, all `spawnSync ps ENOENT` because `ps` is not installed in this container. `backend/reload.spec.ts` passes 8/8 run on its own. The chain stopped before the browser step; run alone it cannot launch at all in this container — the Playwright chromium headless shell is not installed, so all 85 tests fail at `browserType.launch` in a few milliseconds. Neither failure is caused by this work.

Merged in `4e98ed3`; the review fixes in `b343645`.

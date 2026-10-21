# 02: `/reload` in the palette with a strip that tells the truth

**What to build:** `/reload` becomes a built-in command in this client and leaves the TUI-only refusal list, so the name pi taught the user works here instead of being refused. It appears in the palette beside the other built-ins and routes as a built-in, which means it is never sent to the model as literal text. Trailing text after the name is ignored and the reload happens, matching the other argument-less built-ins; pi's own terminal matches the command exactly and would pass the extra text to the model, which is the one outcome that must never happen here.

The command strip carries the whole story. It reads `Reloading…` from the moment the request is sent, and `Reloaded settings, extensions, skills, prompts and context files.` once the Reloaded reply arrives — resources this UI can actually show, not pi's keybindings and terminal themes. An error for that Session leaves no `Reloading…` behind and shows the error in the composer, so a reload that did not happen is never reported as one that did. The same holds when the connection is not connected: the pending text is derived from the connection status the shell already receives rather than cleared by a transport callback reaching into the store, which is both honest after a drop and testable without a socket. Pending lives beside the notice rather than as a string written into it, so clearing it needs no replacement text, and the slice's existing clear on a Session switch means a pending reload cannot follow the reader to another Session.

Because the server re-sends the discoverable commands after a reload, the palette updates without reconnecting: a Commands message that arrives after attach replaces what the palette lists. The guard stays server-side; the client does not duplicate it, so one rule has one home.

**Blocked by:** 01: Reload replaces a Session's Pi child, guarded.

**Status:** resolved

- [x] `/reload` is listed in the palette as a built-in and routes as a built-in
- [x] `/reload` is no longer refused as a TUI-only command, and a submission of it never produces a prompt for the model
- [x] `/reload now` reloads exactly as `/reload` does
- [x] The strip reads `Reloading…` after sending, and the confirmation sentence once the Reloaded reply arrives
- [x] An error for that Session leaves no `Reloading…` on the strip and shows the error in the composer
- [x] A connection that is not connected leaves no `Reloading…` on the strip, produced by deriving the pending text from the connection status the shell already receives
- [x] A Commands message arriving after attach replaces what the palette lists, so a skill the reload discovered appears without reconnecting
- [x] Store tests cover the palette row and the built-in routing, `/reload` with trailing text, `Reloading…` then the confirmation, an error clearing the pending text, a lost connection clearing it, and a late Commands message replacing the palette

## Comments

Design: `../spec.md`. Only built-in at this height: no browser test, because nothing in this ticket needs a real browser or a layout engine (ADR 0009).

Implemented. `BuiltinCommand.Reload` and its palette row are in `packages/client/src/lib/commands/builtins.ts`, and `reload` left `packages/client/src/lib/commands/tui-only.ts`; because routing is by name before any argument is read (`router.ts`), `/reload` and `/reload now` both land on the built-in and trailing text can never become a prompt. The one action is the `BuiltinCommand.Reload` case in `runBuiltin` in `packages/client/src/lib/Shell.svelte`, which records the tap and calls `onReload`; that prop is wired through `packages/client/src/App.svelte` to `transport.reload()` in `packages/client/src/lib/transport.ts`. Pending state is the `reloadPending` flag on the commands slice in `packages/client/src/lib/store/commands.svelte.ts`, cleared by `Reloaded`, by an error naming that Session, and by `clear()` on a Session switch; the strip reads `store.commands.reloadPending && status === ConnectionStatus.Connected`, so a dropped link ends the pending line without a transport callback reaching into the store. `packages/client/test/slash-palette.test.ts` carries the nine cases in `describe("the reload built-in")`, mounted through `packages/client/test/composer-harness.ts`.

The code review found the pending flag was only hidden on a drop, not ended, so story 18 ("no `Reloading…` left behind after my connection drops and returns") was unmet. It now clears through `clearReloadPending()` whenever the status prop leaves `Connected` — still no transport callback reaching into the store — and `/reload` arms nothing while the link is down, because the transport would drop the request. The store tests assert rendered output only, including the drop-and-return case and the down-link case.

No deliberate omission. Nothing changed relative to the ticket after review; the eight checkboxes were ticked on the ticket branch.

Gate (`npm run verify` and `npm run verify:full`): typecheck, lint and format, and build passed; the store, component and backend step failed on the four pre-existing `ps`-dependent specs — `backend/launcher.spec.ts > SIGINT shuts down cleanly and stops the Pi children across every Project`, both `backend/pool-defaults.spec.ts` cases, and `backend/protocol-snapshot.spec.ts > a Projects request answers with the served Projects in order and starts no Pi child`, all `spawnSync ps ENOENT` because `ps` is not installed in this container. The client suite passed 221/221 in 25 files, and the backend suite 44 of 48. The chain stops at that step, so the browser step never runs under `verify:full`; run alone the suite cannot launch in this container — the Playwright chromium headless shell is not installed, so all 85 browser tests fail at `browserType.launch` within a few milliseconds. Neither failure is caused by this work.

Merged in `5153d29`; the review fixes in `b343645`.

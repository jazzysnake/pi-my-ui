# 02: `/reload` in the palette with a strip that tells the truth

**What to build:** `/reload` becomes a built-in command in this client and leaves the TUI-only refusal list, so the name pi taught the user works here instead of being refused. It appears in the palette beside the other built-ins and routes as a built-in, which means it is never sent to the model as literal text. Trailing text after the name is ignored and the reload happens, matching the other argument-less built-ins; pi's own terminal matches the command exactly and would pass the extra text to the model, which is the one outcome that must never happen here.

The command strip carries the whole story. It reads `Reloading…` from the moment the request is sent, and `Reloaded settings, extensions, skills, prompts and context files.` once the Reloaded reply arrives — resources this UI can actually show, not pi's keybindings and terminal themes. An error for that Session leaves no `Reloading…` behind and shows the error in the composer, so a reload that did not happen is never reported as one that did. The same holds when the connection is not connected: the pending text is derived from the connection status the shell already receives rather than cleared by a transport callback reaching into the store, which is both honest after a drop and testable without a socket. Pending lives beside the notice rather than as a string written into it, so clearing it needs no replacement text, and the slice's existing clear on a Session switch means a pending reload cannot follow the reader to another Session.

Because the server re-sends the discoverable commands after a reload, the palette updates without reconnecting: a Commands message that arrives after attach replaces what the palette lists. The guard stays server-side; the client does not duplicate it, so one rule has one home.

**Blocked by:** 01: Reload replaces a Session's Pi child, guarded.

**Status:** ready-for-agent

- [ ] `/reload` is listed in the palette as a built-in and routes as a built-in
- [ ] `/reload` is no longer refused as a TUI-only command, and a submission of it never produces a prompt for the model
- [ ] `/reload now` reloads exactly as `/reload` does
- [ ] The strip reads `Reloading…` after sending, and the confirmation sentence once the Reloaded reply arrives
- [ ] An error for that Session leaves no `Reloading…` on the strip and shows the error in the composer
- [ ] A connection that is not connected leaves no `Reloading…` on the strip, produced by deriving the pending text from the connection status the shell already receives
- [ ] A Commands message arriving after attach replaces what the palette lists, so a skill the reload discovered appears without reconnecting
- [ ] Store tests cover the palette row and the built-in routing, `/reload` with trailing text, `Reloading…` then the confirmation, an error clearing the pending text, a lost connection clearing it, and a late Commands message replacing the palette

## Comments

Design: `../spec.md`. Only built-in at this height: no browser test, because nothing in this ticket needs a real browser or a layout engine (ADR 0009).

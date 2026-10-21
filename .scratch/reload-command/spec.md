Status: ready-for-agent

# `/reload`: reload pi's configuration without losing my Session

Vocabulary is `GLOSSARY.md`; the decision record is `docs/adr/0011-reload-replaces-the-child.md`. Where this spec and that ADR disagree, the ADR is right and this is the bug.

## Problem Statement

I change pi's configuration from my phone as often as I change code: a new skill in my agent directory, a prompt template, an extension I just built, a `models.json` edit. pi-my-ui cannot see any of it. Each Session is served by one Pi child that read those files when it started, and the only thing the browser ever re-reads is a Session's transcript. The command palette and the model picker are sent once, when I attach, so a skill I add while the app is open does not exist as far as this browser is concerned — and nothing in the app tells me that.

pi's own TUI has `/reload` for exactly this. This client knows the name and refuses it: typing `/reload` produces "`/reload` is a pi TUI-only command and is not available in pi-my-ui". The refusal is honest but useless — it names the thing I want and offers nothing. My only options are to wait for the Session's Pi child to be evicted and respawned, to crash it deliberately, or to restart the server, which also throws away every other Session I have open.

The other half of the problem is trust: whatever replaces that refusal must not quietly cost me work. A reload that dropped my Session's place in the tree, renumbered my transcript, killed a running subagent without saying so, or silently killed the `npm test` I started would be worse than no reload at all, because I would only find out afterwards.

## Solution

`/reload` becomes a built-in command in this client. It replaces the Session's Pi child with a fresh process on the same Session file, so every configuration file pi reads at startup is read again — settings, extensions, skills, prompt templates, themes, context files, `models.json`, providers, project trust and the default tool set — and then hands the browser the fresh Projection, a refreshed command palette and refreshed settings, and tells me it happened.

Everything that identifies my Session survives, because the Session *is* its file: the Session id, its entries, its Leaf, its selected model and its thinking level all come back with the new child. The reader's place in the transcript is restored across the reseed, and the command strip says `Reloading…` while it runs and `Reloaded settings, extensions, skills, prompts and context files.` when it finishes.

`/reload` refuses, rather than destroys, when there is work to lose: a running turn, a compaction, a running shell command, or any subagent still queued or running. Each refusal says which one it is, and the Session keeps running.

## User Stories

### Reloading the configuration from my phone

1. As a phone user, I want `/reload` to be a real command in this client, so that a name pi taught me works here instead of being refused.
2. As a phone user, I want `/reload` in the command palette next to the other built-ins, so that I can find it without remembering it is a built-in.
3. As a phone user, I want `/reload` to pick up a skill I just added to my agent directory, so that I can use it in the conversation I am already in.
4. As a phone user, I want `/reload` to pick up a prompt template I just wrote, so that I do not have to leave the app to get a new command.
5. As a phone user, I want `/reload` to pick up an extension I just built and pointed pi at, so that developing an extension does not require restarting the app.
6. As a phone user, I want `/reload` to pick up a `models.json` edit, so that a model I just added or renamed appears in the model picker.
7. As a phone user, I want `/reload` to go through the same configuration a fresh start would read, so that I never have to wonder which of pi's files a reload covers.
8. As a phone user, I want `/reload` to reach only the Session I ran it in, so that reloading one conversation does not disturb four others I have open.
9. As a phone user, I want the command to be per-Session rather than per-server, so that "the config of the process I am talking to" is the mental model, matching a Session being one Pi child.
10. As a phone user, I want a Session whose child died to reload into a working child, so that the one command I have for getting a fresh process is not limited to the healthy case.

### Being told what happened

11. As a phone user, I want the command strip to say `Reloading…` as soon as I send it, so that a second of silence does not read as a hang.
12. As a phone user, I want the strip to say what was reloaded when it finishes, so that I know the new configuration is live rather than merely requested.
13. As a phone user, I want the confirmation to name the resources this app actually reloads, so that it does not tell me about keybindings and terminal themes this UI does not have.
14. As a phone user, I want a failed reload stated as a failure in the composer, so that a reload that did not happen is never reported as one that did.
15. As a phone user, I want a refusal to tell me what is still running, so that I know whether to wait, or to stop something first.
16. As a phone user, I want a refusal naming a count of running subagents, so that I can tell one from several.
17. As a phone user, I want no `Reloading…` left behind after a failure, so that the strip never claims an operation that already ended.
18. As a phone user, I want no `Reloading…` left behind after my connection drops and returns, so that a lost reply does not leave the strip stuck forever.
19. As a phone user, I want the palette to show the new skills and templates after a reload, so that I can see the reload took effect without reconnecting.
20. As a phone user, I want the model picker to show the reloaded model list, so that a reloaded `models.json` is not contradicted by an old picker.
21. As a phone user watching the same Session on a second device, I want its transcript to come back reseeded on its own, so that I am not left reading a stale copy.
22. As a phone user on a second device, I want no "Reloaded" notice for a reload I did not ask for, so that the strip only reports my own actions.

### Losing nothing

23. As a phone user, I want my Session id unchanged, so that the link I am on keeps working.
24. As a phone user, I want every entry in the Session file to stay exactly as it was, so that nothing in the conversation is rewritten.
25. As a phone user, I want my Leaf unchanged, so that the next message continues from where I was and not from the end of some other branch.
26. As a phone user, I want my selected model to come back with the new child, so that a reload does not silently switch which model answers.
27. As a phone user, I want my thinking level to come back with the new child, so that a reload does not silently change how my next turn is answered.
28. As a phone user, I want my auto-compaction setting to come back, so that a reload does not re-enable something I turned off.
29. As a phone user, I want the transcript's scroll position restored across the reseed, so that reloading does not throw me to the bottom of a long conversation.
30. As a phone user, I want the finished subagent rows to stay listed after a reload, so that I keep the record of what my Session did.
31. As a phone user, I want a reload to be refused while my turn is streaming or retrying, so that the answer I am waiting for is not cut in half.
32. As a phone user, I want a reload to be refused while a compaction is running, so that the summary I am waiting for is not cut in half.
33. As a phone user, I want a reload to be refused while a direct shell command is running, so that a long build's output is not destroyed unread.
34. As a phone user, I want a reload to be refused while a subagent is queued or running, so that background work is not aborted without my asking.

### What the reload must never do

35. As a phone user, I want `/reload` never to be sent to the model as literal text, so that a configuration command cannot become a prompt.
36. As a phone user, I want `/reload something` to reload rather than fail, so that stray text after the command does not cost me a retype.
37. As a phone user, I want my other Sessions left alone by a reload, so that a reload never restarts the whole server.
38. As a phone user, I want the reload's failure to leave the Session addressable, so that fixing the broken file and trying again is enough.

## Implementation Decisions

**Mechanism: replace the child.** `/reload` stops the Session's Pi child and starts another on the same Session file, through the path that already replaces a child for eviction, a crash and an explicit reconnect. The pool's one-child-per-Session rule is kept by reusing that path rather than by adding a second one. Startup is the definition of "read the configuration": a reload that went through any narrower set of files would be a second, weaker notion of what pi reads.

**Why not pi's in-process reload.** pi's `/reload` calls its own reload on the live session, which replaces the extension runtime and resource loader without touching the process. That is a smaller hammer but a worse one here. The server already owns the Projection and a browser already reattaches to a reseeded stream without losing its place, so the in-process reload preserves nothing this app can observe; it is not atomic — the old extension runtime is invalidated before the new one is built, so a resource that fails to load leaves the live session half-swapped; and reaching it at all needs an extension command registered by the Bridge plus a way to prove the reload succeeded, because pi's command path reports a thrown handler as handled. Writing the reasoning down is `docs/adr/0011`.

**Refusals.** The server refuses a reload before doing any child work when the Projection shows: a run that is streaming or retrying; a run that is compacting; any direct shell command whose block has no result yet; or any subagent whose status is queued or running. Each refusal is a protocol error with the "the server refused a well-formed request" code, whose message names the condition: pi's own wording for the streaming turn and the compaction ("Wait for the current response to finish before reloading." and "Wait for compaction to finish before reloading."), the command itself for a running shell command, and a count for subagents. Refusals live server-side only; the client does not pre-empt them, so one rule has one home and a second viewer cannot confuse it with its own stale copy.

**Wire contract.** The protocol gains a Reload request and a Reloaded reply, both naming the Session, in the shape the other session commands use. The reply carries no text: the wording belongs to the client, like the other confirmation copy. The reply is only ever sent to the viewer that asked. The order on that socket is Snapshot, then the refreshed supplements, then Reloaded, so a client that acts on the reply is looking at the new state.

**What the browser re-reads.** A reseed already broadcasts a fresh Snapshot to every viewer of the Session. The reload additionally re-sends the three supplements a viewer gets on attach — settings (with the available models), commands, and context usage — to every viewer of that Session, because the new child's answers can all differ and the palette and model picker are otherwise stale until the next attach.

**Confirmation and pending state.** The command strip renders `Reloading…` while a reload is pending and `Reloaded settings, extensions, skills, prompts and context files.` once Reloaded arrives. Pending is a flag beside the strip's notice, not a string written into it, so clearing it needs no replacement text. It clears on Reloaded, on any error for that Session, and when the connection is lost, so a failed reload and a dropped socket both leave the strip honest.

**Arguments.** Trailing text after `/reload` is ignored and the reload happens. pi's own TUI matches the command exactly and would pass `/reload now` to the model; here the name is already a built-in, so that spelling can never become a prompt, and ignoring the text matches the other argument-less built-ins.

**Scope.** A reload affects one Session: one Pi child, one Projection, one reseed. The server, its registry, the pool's configuration and every other Session are untouched. Because each Session has its own child, another open Session keeps its old configuration until it is reloaded or its child is replaced — that is the honest consequence of one process per Session, and it is what the command promises.

**Failure.** If the new child cannot start, the reload fails with the start error in the composer and the Session is left unseeded; the next action that needs a child starts one and reports its own failure if the configuration is still broken. No crashed or needs-reconnect state is invented, because nothing died: a start that never happened is not an exit.

**Explicitly unchanged.** The Bridge and its command surface, the Snapshot/Delta/Cursor model, the transport's reconnect and resync, the eviction window, the one-child-per-Session rule, the palette's merge of built-ins with discovered commands, and the scroll-anchoring that already survives a resync. The TUI-only list loses `reload` and nothing else.

## Testing Decisions

A good test asserts an observable outcome and says nothing about how it was produced: the messages a real WebSocket client receives in the backend suite, the rendered strip and what the composer sends in the store suite. No new seam is introduced — the backend suite is the existing real-server, real-Pi-child entrance, and the store suite is the existing jsdom height, which is the signal that the boundary is right. No browser test is added: nothing here needs a real layout engine or a real browser, and ADR 0009's admission rule requires a wiring claim this feature does not have.

The claims, by height:

- Store: `/reload` is a built-in — it is routed as a built-in, never as a TUI-only refusal, and never produces a prompt for the model.
- Store: the strip shows `Reloading…` after sending and the confirmation on Reloaded; an error leaves no `Reloading…` behind; a lost connection leaves none either.
- Backend: the mechanism. A skill file written into the hermetic agent directory *after* attach is absent from the Commands message the viewer received; a Reload then yields a Snapshot whose Session id, entries and Leaf are unchanged, a Commands message that now carries that skill, and a Reloaded reply — in that order.
- Backend: each refusal — a streaming turn, a running direct shell command, a queued or running subagent — is refused with the reason in the error message, and the Session keeps running afterwards (the streaming turn still delivers its reply).
- Backend: a reload in a Session nobody else watches leaves a second Session's child and Snapshot alone.

Prior art: the backend specs that already host a hermetic agent directory and write pi's settings into it, and the backend specs that reseed and resync a Session against a real child; the store tests that mount the shell and assert the palette and the command strip, including the existing TUI-only refusal test, which stops covering `reload` and keeps covering the rest of the list.

## Out of Scope

- Reloading other Sessions, or every Session, from one command; no "reload all" control.
- A server-wide configuration reload, or a restart of the server process.
- Replacing the subprocess with pi's in-process reload, or offering both.
- Reproducing the parts of pi's `/reload` that exist for its terminal UI: keybindings, theme reapplication, autocomplete rebuilding, the reload box.
- Watching configuration files and reloading automatically when one changes.
- Any change to the Bridge, its commands, or how the server invokes them.
- Any change to the pool's eviction window, keep-alive behaviour or memory ceiling.
- A general "refresh this Session" control beyond the reload itself.
- Restoring a subagent's conversation across a reload; the reseed already drops past agent conversations, as it does for a respawn today.

## Further Notes

**Cost, measured.** A respawn from the Session file measures 862 ms and a cold start to a served Session 900 ms (`docs/measurements.md`), against single-digit milliseconds for an in-process reload. That is the price of the mechanism, paid once per deliberate reload, behind an explicit tap. It is also why the pending state is part of this spec rather than a polish item.

**What the reseed does to a Session, already today.** The transcript is rebuilt from the file, the Cursor is renumbered and the delta history is dropped, so every viewer gets a full Snapshot; the reader's anchor is restored by the transcript's existing scroll anchoring. Finished subagent rows are kept and their conversations are forgotten — the same trade a respawn makes now, and the reason the guard refuses while any agent is still live.

**Inherited, not promised.** The respawn path a reload uses is already memoized, so a second reload that lands while one is running is absorbed by the in-flight restart rather than starting a second child — that is the existing one-child-per-Session rule doing its work, not a behaviour this feature adds, and it is deliberately not stated as a user story. Nothing else about a reload is shared between requests: each request that starts its own restart gets its own reseed and its own reply.

**pi's `/reload` is not this.** pi's TUI command reloads resources in the live process, refuses only a streaming turn or a running compaction, and says "Reloaded keybindings, extensions, skills, prompts, themes, and context files". This command reaches the same or a wider set of files, refuses more, and reports what this UI can actually show. Anyone comparing the two should read ADR 0011 first.

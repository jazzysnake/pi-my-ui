Status: draft

# Transcript rows: failed turns, the copy control, and what the drawer lists

Vocabulary is `GLOSSARY.md`.

**For every UI change here, the prototype is the de-facto spec.** `packages/client/src/lib/prototype/`
(`npm run prototype:rows`; variant A, the owner's pick, is the reference row, and `?variant=A&w=320`
shows it at the smallest phone) is normative for the card, the corner control, the thinking box, the
code strip, the error block's shape and the spacing between rows. The prose below names the decisions,
the seams and the tokens; where prose and prototype disagree, the prototype is right and the prose is
the bug. Nothing in this document overrides what the prototype renders.

## Problem Statement

One pass over the phone UI on real Sessions found five defects.

**A failed turn leaves no readable trace.** When a provider call fails, pi records an assistant message
with `stopReason: "error"`, no content, and an `errorMessage`. The live path removes the empty row and
reports the failure only as a transient run-state row above the composer
(`session-projection.ts`, `onAgentEnd`); the seed path keeps the row and discards the error
(`projection.ts`, `projectMessage`). After a reload the same failure is an empty row with a copy
control that copies nothing, so "why did this turn stop" is unanswerable from the transcript. The two
paths read different sources — a persisted entry tree versus a live event stream — and that part is
fine; what is wrong is that only one of them decides what a failed attempt projects to.

**The copy control does not read as the message's.** Every non-notification row renders one control
vertically centred on the right edge (`Transcript.svelte`): 44 px tall, so it also sets the row's
height, and outside any visible container. On a message that opens with a thinking block it sits level
with that block's header and reads as the thinking block's control, while the message itself reads as
not copyable. The owner: "visually it looks like the copy button belongs to the thinking block, but in
reality the thinking block does not have one."

**Nothing shows where a message starts and ends.** No row has a boundary, so consecutive messages run
together at 12 px of gap. Tool-call cards are the transcript's only boxed objects, which makes the
transcript's only visible structure its nested cards — the owner's word for the current state is that
messages are not "visually separated the way tool calls are".

**Fenced code cannot be copied on its own.** The message-level copy is the only control, so a command
inside a reply can only be taken by copying the whole message and trimming it by hand.

**The drawer lists subagent runs as Sessions.** pi-subagents persists each run as its own pi Session
in the same directory, with the spawning Session's file in its header. `listSessions` maps every file
pi reports (`sessions.ts`), so each subagent run appears twice: as a row in the drawer and as a run
behind the agent pill.

## Solution

Give the transcript a row type that states its own boundary, then hang the copy affordance and the
failed turn off it.

A message becomes a card: a hairline border, a surface that encodes the role (raised for the reader,
plain for the assistant), and its copy control inside the card's top-right corner. The card's first
block yields the control's column, so nothing is ever drawn under it — when that first block is a
thinking row, the row's own box simply ends short of the control. Thinking rows keep their hairline box
and get no copy control of their own; a tool call keeps its markup and is told apart by its name,
status word and output, not by being the only box inside a card. Fenced code gets its own control
inside the block, and a failed attempt becomes an error block in the message's own card, carrying pi's
error text and no copy control.

The drawer keeps listing disk facts; it stops listing a file whose header names a parent Session *and*
whose name carries the run-id shape pi-subagents gives a child, which is what distinguishes an agent's
child from the owner's own fork.

## User Stories

### Reading a failed turn

1. As a phone user, I want a failed turn to show pi's own error text where the turn stopped, so that I
   can tell a network failure from a bad tool call without opening a log.
2. As a phone user, I want that error still there after I reload or rejoin, so that the record of a
   failure outlives the run-state row that only appears while the run is live.
3. As a phone user, I want a failed turn to look like a failure (danger tone, stated as an error), so
   that I do not read it as an empty message.
4. As a phone user, I want an error row to offer no copy control, so that a control that copies
   nothing never appears.
5. As a phone user, I want a cancelled or empty attempt to leave no row at all, so that the transcript
   has no blank gaps.

### Copying what I read

6. As a phone user, I want one copy control per message, inside the message's own card at its top-right
   corner, so that I can tell whose control it is.
7. As a phone user, I want the control to exist only when there is text to copy, so that it never
   copies nothing.
8. As a phone user, I want tapping it to confirm with a check that fades, so that I know the copy
   happened without a toast.
9. As a phone user, I want each fenced code block to have its own copy control, copying the code and
   not the fences, so that I can take a command out of a long reply.
10. As a phone user, I want a thinking block to stay collapsed by default and to have no copy control
    of its own, so that the card's control is unambiguous.
11. As a phone user, I want notification cards to carry no copy control, so that extension payloads
    are not mistaken for something I am meant to quote.
12. As a phone user, I want the control to meet the 44 px touch rule, so that it is tappable with a
    thumb.
13. As a screen-reader user, I want the control's name to stay the same and the confirmation to be
    announced once, so that the control does not rename itself under me.
14. As a phone user, I want the copy to carry the same text as today (text blocks plus a bash card's
    command and output), so that nothing I could copy before stops being copyable.

### Telling rows apart

15. As a phone user, I want every message to sit inside a visible card, so that I can see where one
    message ends and the next begins.
16. As a phone user, I want the reader's own messages to look different from the assistant's without a
    new colour language, so that scanning for my own turns is instant.
17. As a phone user, I want tool calls to keep exactly the presentation they have, so that a change to
    message rows does not make me relearn them.
18. As a phone user, I want tool calls to stay exactly as distinguishable as they are, so that a tool
    call is never mistaken for a thinking row or for a nested message.
19. As a phone user, I want the layout to hold at 320 px with the control in place, so that the corner
    control never pushes text off the screen.

### The drawer

20. As a phone user, I want subagent runs absent from the drawer, so that the drawer lists the
    Sessions I started and nothing else.
21. As a phone user, I want my own forks and clones to stay listed, so that hiding subagent children
    never hides a Session I forked.
22. As a phone user, I want the hidden rows to leave the unread and working overlays untouched, so
    that hiding a child changes nothing about the rows that remain.
23. As the owner, I want the filter to fail by listing an extra row rather than by hiding one, so that
    a misclassification can never lose a Session.

## Implementation Decisions

**One rule for a failed attempt.** `blocksFromMessage` (`server/src/projection.ts`) is the seam both
paths already share: the seed calls it from `projectMessage`, the live path from `onMessageEnd`. An
assistant message with `stopReason === "error"` projects an additional error block carrying
`errorMessage` (falling back to "the run failed"), so neither path can drift from the other. The seed
path additionally drops a message entry whose projected blocks are empty, which the live path already
does for its placeholder; that is the whole of the divergence, and it is fixed in one place rather than
by unifying the two readers, whose inputs really are different.

**Protocol.** `ContentBlockType.Error` with an `ErrorBlock { type, text }`, added to the `ContentBlock`
union and to the validators. No version constant is involved: both ends ship together (ADR 0004).

**Error presentation.** Inside the message's card, after its content blocks: a danger-toned box with a
meta-caps `error` label and the text, `break-words`, no copy control. When the attempt produced no
content the box is the card's only block. The run-state row keeps reporting the failure while the run
is live; the card is the durable record, and having both is intended.

**One card per message.** Assistant: `rounded border border-hairline bg-panel`. Reader: the same with
`bg-panel-raised` and `border-hairline-strong` — the surface carries the role, so the accent stays
reserved for links and commands. Padding 6 px top, 10 px sides and bottom; 20 px between cards. Tool
calls, bash cards and notification cards keep their current markup and type size; a tool call nests
inside the card, and its name, status word and output are what keep it a different object from the
thinking row it may sit beside.

**The copy control.** One per message card, absolutely positioned inside the top-right corner
(not straddling the border, which the owner read as stray), 44×44 with a 16 px glyph. It renders iff
`entryText(entry)` is non-empty; on a thinking-only message there is therefore no control and the
thinking row uses the full width. The card's first block yields the control's column with a right
padding of 44 px + inset, so no content is drawn under the control; a thinking row as first block ends
its box short of that column and keeps the rest of its width.

**Confirmation.** On a resolved `navigator.clipboard.writeText`, swap the glyph for a check in the
success tone for 1.4 s; the accessible name stays "Copy message" and a visually hidden polite region
announces "Copied". A rejected write leaves the glyph unchanged.

**Reasoning row.** It keeps its own hairline box inside the card (`bg-canvas`, rounded) and carries no
copy control: chevron plus "Thinking", 44 px tap height, collapsed by default. When it is the card's
first block its box is narrowed so it ends clear of the copy column — the control then sits beside the
box, not on it, and the two are never mistaken for each other's. The box, the card and the tool call
are three nested boundaries the reader can see; the tool call remains the only one that carries a
status.

**Code blocks.** Per fenced block: the code text only, no fences, no language label. The control sits
in a 28 px strip at the block's top-right with a 44 px tap box that overflows into the block's own
padding — the code scrolls horizontally, so an overlay pinned over the corner would sit on top of
code. `renderMarkdown` keeps its single sanitized HTML sink; the control is attached by a client-side
upgrade pass over the rendered container that inserts the control into each `pre` and reads the code
text from the DOM when tapped, so sanitized output remains the only HTML source.

**The drawer.** `listSessions` drops a Session when **both** hold: `SessionInfo.parentSessionPath` is
set, and the Session's name ends with `#` plus eight characters — the shape pi-subagents gives a run's
child session (`<agent type>#<first 8 of the run id>`). Both facts come from pi's own listing, so no
file is opened a second time. The parent pointer alone is wrong: pi also sets it for the owner's own
forks and clones. Requiring the name shape makes the failure mode "a child session is listed", which
is today's behaviour, never "a fork disappeared".

**Tap targets.** The message copy and the code copy are 44 px boxes (the code one overflowing a 28 px
strip); the reasoning header keeps today's 44 px row height. The prototype renders the reasoning header
at 32 px to show how much tighter that would look; the spec chooses the rule-consistent 44 px.

## Testing Decisions

Layer 2 (store and component tests feeding `ServerMessage`s) and layer 1 (end-to-end against real pi) as
ADR 0005 requires.

- **Server, seed:** a Session file containing a failed assistant message seeds an error block carrying
  the error text; a Session file containing an empty assistant message seeds no row for it. Both
  through `projectionBatch`, not by asserting on internals.
- **Server, live:** a scripted provider that ends a run with an error renders the same error block
  live, and it still renders after a resync — the pair that proves the two readers agree.
- **Server, drawer:** a directory holding an ordinary Session, a fork (`parentSessionPath` set, no
  `#` name tail) and a subagent child (parent set, name tail present) lists the first two only.
- **Client, copy:** a copy control exists on a message with text and not on a notification, an error
  block, a compaction boundary or a thinking-only message; tapping it writes `entryText()` and swaps
  the glyph for the check, which reverts on fake timers; a rejected write leaves it unchanged; the code
  block's control writes the code without fences.
- **Client, geometry:** the control renders inside the card's border and the first block carries the
  yield, asserted through the DOM rather than by class-name matching.
- **End-to-end:** a seeded Session with a real failed turn shows the error text after reload; the
  drawer excludes a subagent child while keeping the fork; `touch-targets.spec.ts` covers the new
  controls; the existing `markdown.spec.ts` copy assertion moves to the card's control.

## Out of Scope

- Copy controls for notifications, reasoning, tool-call output, or a whole Session.
- Language labels, syntax highlighting, or code folding.
- Collapsing or hiding messages on the phone.
- A drawer toggle to reveal subagent children.
- Any change to how pi persists a Session, or to pi-subagents' naming.
- Reworking the notification card's presentation beyond keeping its current markup.

## Further Notes

- The prototype is throwaway as code and normative as reference. Variant A is the approved row; variant
  B (rail plus gutter) and variant C (named header rule) lost, and the error strip variant is rejected
  in favour of the card because a card is the transcript's one boundary vocabulary. The losing variants
  and the switcher belong on a throwaway branch as the primary source for these tickets, not on main;
  the approved variant's markup is what the implementation is written from.
- The prototype's `?errors=card|strip` toggle exists only so the owner could compare the two error
  treatments; the strip is not carried into the implementation.
- A failed turn's card and the live run-state row both name the failure on purpose: one is durable,
  the other states what the run is doing right now.
- `errorMessage` is optional in pi's types; the fallback string is the same one the run state uses
  today.
- The drawer filter reads `SessionInfo.parentSessionPath`, which pi derives while listing; if a future
  pi stops reporting it, the filter stops hiding children rather than hiding ordinary Sessions.

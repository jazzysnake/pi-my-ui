# 01: A message is a card, and the copy control belongs to it

**What to build:** Every message row except notification cards and compaction boundaries sits inside
a visible card: the reader's messages on a raised surface, every other role on the plain panel
surface. The message's copy control lives inside the card's top-right corner, is a 44 px target with
a 16 px glyph, and only appears when the message has copyable text. The card's first block yields
the control's column, so nothing is drawn under it.

A thinking row remains its own collapsed hairline box with a chevron and "Thinking", carries no copy
control, and ends clear of the copy column when it is the card's first block. Tool calls and bash
cards keep their existing markup and type size and nest inside the card; notifications keep their
current card. Tapping copy writes the same text as today and swaps the glyph for a check in the
success tone for 1.4 s, then reverts. The accessible name stays "Copy message" and a visually hidden
polite region announces "Copied". A rejected write leaves the glyph unchanged. The layout holds at
320 px.

Reference: the committed transcript-row prototype, variant A, and the approved screenshot in this
feature's evidence folder are normative for appearance. Use their look, not their code.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Assistant, reader, bash and orphan tool-result message rows render inside a bordered card;
      notification cards and compaction boundaries keep their current presentation.
- [x] The reader's card uses the raised surface and the stronger hairline; every other role uses the
      plain panel surface, so role is carried without a new accent colour.
- [x] A message card shows one copy control inside its top-right corner, inset from the border, only
      when the message's clipboard text is non-empty.
- [x] No copy control appears on notifications, compaction boundaries, thinking-only messages,
      tool-call-only messages, or error-only messages.
- [x] When the control renders, the card's first block reserves its column and no content is drawn
      beneath it; a first thinking row ends clear of the column.
- [x] The thinking row is a hairline box on the canvas surface with a chevron and "Thinking", 44 px
      tap height, collapsed by default, and has no copy control of its own.
- [x] Tool calls and bash cards keep their current markup and type size, and remain visibly distinct
      objects inside the card.
- [x] Tapping the control writes the message's clipboard text; on success the glyph becomes a check
      in the success tone for 1.4 s and reverts.
- [x] The control's accessible name stays "Copy message" through the confirmation, and "Copied" is
      announced once in a polite live region.
- [x] A rejected clipboard write leaves the glyph and the live region unchanged.
- [x] The card, control and first-block yield hold at 320 px without pushing text off screen or
      widening the page.
- [x] Component tests cover copy presence, the written text, the check confirmation and its revert
      on fake timers, rejected writes, and the first-block yield measured through the DOM.
- [x] The end-to-end touch-target check covers the new copy control.
- [x] The existing markdown copy assertion points at the message card's control.

## Comments

Resolved on `integration/ui-pass-2` by merge `7454d1f`; the code-review follow-up is `f460a60`.
The transcript now has `MessageCard.svelte` (role surface, in-card copy control, first-block yield),
`CopyButton.svelte` (1.4 s check, stable name, polite announcement, rejected-write no-op), and
`ThinkingRow.svelte` (chevron, collapsed, no visible header rule, no copy control). Tool and bash
cards keep their markup; notifications and compaction boundaries stay outside the card. Coverage is
the component suite plus `markdown.spec.ts` at 320 px and the touch-target sweep.

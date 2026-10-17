# 38: The composer's model, effort and auto-compact controls lost their colour

**Category:** bug

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Symptom:** The three controls above the input render as borderless grey text, so the row reads as a
caption rather than three controls and the auto-compact toggle never shows that it is on. Owner: "the
autocompact is missing the green highlight while the effort and model selectors are missing the blue
highlight."

**Repro:** open a Session with auto-compact on and look at the row between the transcript and the
input. Compare with the previous UI.

**Evidence:** `acceptance-1/crop-v2-status-strip.png` (grey, no borders, no state colour) against
`acceptance-1/crop-v1-status-strip.png` (model and effort in accent blue inside a hairline border,
auto-compact green and right-aligned), both at 3x.

**Desired:** the model and effort controls carry the accent tone the previous UI gave them, and
auto-compact shows the green highlight while it is on — and the plain tone while it is off — so its
state is readable without reading the word.

**Previous UI, for comparison (v1, `../pi-my-ui`, read-only reference):**
`packages/client/src/components/composer/ComposerStatus.svelte`.

**Done when**

- [ ] Model and effort read in the accent tone, visually distinct from the auto-compact toggle
- [ ] Auto-compact shows the green highlight while on and no green while off
- [ ] The row still fits at 320 px without horizontal scroll, and no label is cut off
- [ ] Side by side with the previous UI at 393 px and 320 px
- [ ] `npm run verify` green

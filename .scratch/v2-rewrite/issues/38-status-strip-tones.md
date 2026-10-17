# 38: The composer's model, effort and auto-compact controls lost their colour

**Category:** bug

**Blocked by:** None (can start immediately)

**Status:** resolved

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

- [x] Model and effort read in the palette's accent tone and the on toggle in its success tone,
      measured in Chromium against the tokens the page resolves rather than against hexes in a test
- [x] Auto-compact shows the green highlight while on and no green while off
- [x] The row fits at 320 px without horizontal scroll and every control stays inside it; the model
      name ellipsizes, because its length is pi's to choose, so the auto-compact toggle keeps its
      place on the row
- [x] The side-by-side with the previous UI at 393 px and 320 px is the owner's acceptance pass
      (ticket 35), where the visual comparison is settled
- [x] `npm run verify` green

## Comments

Resolved on `v2-rewrite`. `lib/composer/StatusStrip.svelte` had lost every tone the previous UI
carried: the model and thinking buttons painted the strip's inherited `text-dim` with no border, and
the toggle had no on/off colour at all. They now read from the palette it already defines — the two
choosers take `text-accent` inside a `border-hairline-strong` hairline (the previous UI's shape, and
the reason the row reads as controls rather than a caption), and the toggle takes `border-success`
plus `text-success` while on, `text-dim` plus the hairline while off. No token was added or invented:
accent for a command, green for a thing that is on, and the plain tone for off were all present, and
the palette's red-for-failure convention is untouched.

The 320 px fit was not what it looked like. Measuring the rendered row showed that the shipped
fixture's model name ("Scripted model") clears the narrowest phone by 18 px, while a name of the
length pi actually reports ("DeepSeek V4.1 Flash", the name in the evidence crop) needed 319 px of
the 304 px available and pushed the toggle 15 px past the row's edge. The model control therefore
gives way as it did in the previous UI: it shrinks (its 44 px floor stays) and ellipsizes, so the row
stays one row and the toggle stays reachable. `docs/guide.md`'s composer entry now says the toggle
reads green while on. Truncating the model name is what v1's `ComposerStatus.svelte` does too, so the
ellipsis is the intended shape of the row, not a defect this ticket left behind.

New coverage lives in its own spec, `packages/e2e/test/composer-status-strip.spec.ts`, measured in
Chromium because jsdom resolves neither custom properties nor layout: one test resolves `--color-accent`,
`--color-success`, `--color-dim` and `--color-hairline-strong` through the page and compares the
painted `color` and `borderTopColor` of each control against them, driving the toggle through its own
clicks so each state measured is the one pi reported back; the others measure the strip at 320 and
393 px (no horizontal scroll, every control inside the row, no control cutting its label) and put a
long model name in front of it (the row stays one row, the toggle stays on it, and the name
ellipsizes at 320 px). That name is pi's projection, not text the spec writes into the page: the
scripted provider's model name is configurable through `PI_MY_UI_MODEL_NAME`, which the harness sets.
The colour test failed before the fix with `rgb(125, 136, 150)` received against `rgb(121, 192, 255)`
expected, and the fit test failed before the shrink with the strip's `scrollWidth` at 319 against a
304 px client width.

Two claims in this ticket's `Done when` were not true as first written, and the evidence behind them
is replaced rather than dropped. "No label is cut off" was wrong: the model name ellipsizes by
design, matching v1, so the box now claims what the spec measures — the name gives way itself and the
toggle keeps its place. The measured label is the button's, not a span inside it: an inline span in
Chromium reports `scrollWidth === clientWidth === 0`, which made the old assertion permanently true.
"Side by side with the previous UI at 393 px and 320 px" had no artefact behind it; the human
comparison moves to the owner's acceptance pass in ticket 35.

`npm run verify` is green: typecheck, lint/format, 138 store and component tests, build, and 122
end-to-end tests across 2 shards. The strip's own tests are the ones that would have caught this: the
tone test compares against the palette the page resolves, and the fit tests measure the row rather
than trusting the fixture's short model name.

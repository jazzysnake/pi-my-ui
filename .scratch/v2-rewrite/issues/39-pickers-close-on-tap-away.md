# 39: An open model or effort list does not close when you tap away

**Category:** bug

**Blocked by:** 38

**Status:** resolved

**Symptom:** Tapping the model control opens a list of models. Tapping anywhere outside that list
leaves it open, so the only way to dismiss it is to tap its own control again. Owner: "when I click on
the model selector the list appears, but when I click away without selecting one, it does not close."
The same applies to the effort list.

**Repro:** open a Session, tap the model control, then tap the transcript (or the input, or the
header) without choosing a row. The list is still up.

**Desired:** a tap anywhere outside an open list dismisses it and applies no change. Choosing a row
still applies that choice and closes the list, once.

**Done when**

- [x] A tap outside an open model list dismisses it and the model is unchanged
- [x] A tap outside an open effort list dismisses it and the effort is unchanged
- [x] Choosing a row still applies it and closes the list, with no flicker and no second toggle
- [x] Opening one list while the other is open leaves only the newly opened one
- [x] `npm run verify` green

## Comments

Resolved on `v2-rewrite`. `lib/composer/StatusStrip.svelte` now registers a window `pointerdown`
listener while a picker is open and calls `onOpenChange(null)` when the tap lands outside it. The
listener is added by a `$effect` that reads `open`, so it exists only while a list does; the opening
tap's pointerdown has already been dispatched by the time the effect attaches it, which is why
opening does not immediately close.

The dismissal mechanism is not the scrim the repo's other overlays use (the Sessions and Files
drawers, the agent list, the fork picker). Those are modal surfaces that must block the content
beneath; a picker anchored above the input is not. A scrim button would swallow the tap instead of
letting it through — tapping the input after opening a list would close the list but not focus the
input — and it would sit over the other picker's toggle, so switching lists would take two taps. The
tests assert the input is focused after the tap, which a scrim cannot satisfy.

`pointerdown` rather than a document `click` with a containment check, because most of the page is
plain text: on touch a tap on a transcript paragraph is not a click target, so a click listener would
never hear the dismissal the owner asked for. The cost is that a touch scroll begins with a
pointerdown and therefore dismisses too; a transient menu that hears every tap is the better trade.
The picker's two toggles and both lists carry `data-picker-owned`, and the outside handler ignores
taps inside them. That marker is what keeps a row tap from being dropped and a tap on the open toggle
from closing on pointerdown and reopening on the click: removing it from the model toggle alone made
the same-toggle test fail with the list still up, so the guard is load-bearing.

Coverage is `packages/e2e/test/composer-controls.spec.ts`, driven through real touch taps
(`locator.tap()` under the suite's Pixel 5 profile) because Chromium's touch path is what the bug is
about. Three tests: the model list dismissed by a tap on transcript text, the effort list dismissed
by a tap on the input, and one that switches lists with one tap and then chooses a non-current
thinking level and the model row, proving the row tap applied once and the list closed. Before the
fix the first two failed with `model-options` / `thinking-options` expected `0` received `1` and the
value untouched, which is the owner's symptom. `docs/guide.md`'s composer entry now says a tap
anywhere else closes an open picker without changing the value.

`npm run verify` is green: typecheck, lint/format, 134 client and store tests, build, and 118
end-to-end tests across 2 shards (+3 for this ticket).

# 41: The agent pill sits in the header; the owner wants it where the session state was

**Category:** bug

**Blocked by:** 37

**Status:** resolved

**Symptom:** The agent pill renders in the top header, between the truncating wordmark and the Files
control, where it competes with both for the row and reads as a header badge. Owner: "I'd like the
agent pill to move to where the session ready is in the old ui."

**Repro:** open a Session with a subagent running and look at the header row.

**Evidence:** `acceptance-1/crop-v2-header.png` (the rounded `@handle` pill inside the header).
Previous UI: `acceptance-1/v1-composer.png` shows the `SESSION Ready` line in the run's own row.

**Desired:** the pill occupies the place the session state word occupies in the previous UI — the
second row, leading edge — and the header goes back to holding navigation controls only.

**Previous UI, for comparison (v1, `../pi-my-ui`, read-only reference):** the header carries nothing
but the sidebar toggle, the wordmark, the connection dot and Files
(`packages/client/src/components/AppShell.svelte`); the pill renders on its own line adjacent to the
session state row (`packages/client/src/components/subagent/AgentPill.svelte`), with the same `diamond`
glyph and derived label.

**Decision (owner):** the pill takes the slot and the `run-activity` marker goes with it — the pill
replaces it rather than sitting beside it. A live run is then announced by the composer's stop control
and by the transcript's own growth, which is what the owner reads anyway; no second marker is added
to the trailing edge. The marker's `run-activity` and `run-activity-label` test ids disappear, so
whatever asserted them has to move to the control that now carries that meaning rather than lose its
coverage.

**Done when**

- [x] The pill renders in the session's own row, at its leading edge, and not in the header
- [x] The header holds only the sidebar toggle, the wordmark, connection status and Files
- [x] Tapping the pill still opens the agent list, with the same label and count as now
- [x] The row fits at 320 px: no wrapping, and the pill truncates before anything is pushed off-screen
- [x] The session bar's leading edge is the pill and nothing else; no `run-activity` marker remains, and
      the tests that asserted it now assert the composer's stop control instead
- [x] `npm run verify` green

## Comments

Resolved on `v2-rewrite`. The agent pill left the header's end group and now leads the session bar,
the row where the previous UI put its session state word; the header is back to the sidebar toggle,
the truncating wordmark, the connection status and Files, with Files still closing the row for ticket
37's safe-area reason. The pill keeps its `min-h-11`/`min-w-11` tap target and its `max-w-40` cap, so
it truncates its label before the context readout is pushed anywhere: at 320 px the readout still
ends inside the bar's padding.

The run-activity marker went with the slot, as the owner decided. `isOutputInFlight` in
`lib/run-state.ts` existed only to feed that marker, so it is gone too; a live run is now announced by
the composer's stop control, the transcript's growth, and the tool card's own **Running** status.

Coverage, written red first:

- `packages/client/test/agent-pill.test.ts` asserts the pill is a child of the session bar, is its
  first element, and is not inside the header. It failed before the move with "the pill is not inside
  the session bar".
- `packages/client/test/header.test.ts` asserts that while a subagent runs and the run is streaming,
  the header contains no pill and holds only `sessions-toggle` and `files-toggle`, and that no
  `run-activity` element exists anywhere in the shell.
- `packages/e2e/test/phone-layout.spec.ts` measures the rendered session bar at 320 px: the pill
  leads, sits out of the header, no marker exists, the pill is one line tall and no wider than its
  160 px cap, its right edge ends before the context readout begins, the readout stays inside the
  bar, and the page does not scroll horizontally.

`packages/e2e/test/phone-fit.spec.ts`'s reduced-motion test no longer names a second pulsing surface:
the tool card's `running` status is the only one left, and the test still proves its `pulse` runs and
that `reduce` turns it off. What the removed marker asserted is now asserted on the control that
carries that meaning — the test checks the composer reads **Stop** during the run and **Send** after
the tap, through the existing `expectComposerSend` helper.

`docs/guide.md`'s region list now names the pill at the session bar's leading edge and drops the
**Streaming** marker from it.

`npm run verify` is green: typecheck, lint/format, 138 client tests (+2), build, and 120 end-to-end
tests across 2 shards (+1) in ~48 s.

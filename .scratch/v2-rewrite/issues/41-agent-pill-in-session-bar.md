# 41: The agent pill sits in the header; the owner wants it where the session state was

**Category:** bug

**Blocked by:** 37

**Status:** ready-for-agent

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

- [ ] The pill renders in the session's own row, at its leading edge, and not in the header
- [ ] The header holds only the sidebar toggle, the wordmark, connection status and Files
- [ ] Tapping the pill still opens the agent list, with the same label and count as now
- [ ] The row fits at 320 px: no wrapping, and the pill truncates before anything is pushed off-screen
- [ ] The session bar's leading edge is the pill and nothing else; no `run-activity` marker remains, and
      the tests that asserted it now assert the composer's stop control instead
- [ ] `npm run verify` green

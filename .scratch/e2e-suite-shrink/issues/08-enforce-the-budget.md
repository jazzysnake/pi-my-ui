# 08: Enforce the 45-second budget

**What to build:** A small script that times a normal end-to-end run and fails above 45 seconds, with the machine and worker count that produced the number recorded in a comment. It neither shards nor reconciles — that machinery existed to keep shards honest, and there are no shards. It replaces two hundred lines with about thirty and keeps the one property worth keeping: the suite cannot quietly regrow without the gate going red.

The measured before-and-after figures go on the spec, because the projection of 20 to 25 seconds is an estimate until this ticket runs the number.

**Blocked by:** 02, 03, 04, 05, 07 — every gate conversion, the rig deletion and the worker pin. Without them the run is above the budget by construction.

**Status:** ready-for-agent

- [ ] One script times the end-to-end suite and exits non-zero above 45 seconds
- [ ] The budget constant is declared once, with the machine and worker count it was measured on in a comment
- [ ] The full verification gate uses the budget script rather than calling Playwright directly
- [ ] A run over budget is proven to fail the gate, not proven by inspection
- [ ] The measured wall clock and the measured test-body total are recorded on the spec, beside the figures taken before the work
- [ ] The suite is green and under budget on the pinned worker count

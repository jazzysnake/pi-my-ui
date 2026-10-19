# 08: Enforce the 45-second budget

**What to build:** A small script that times a normal end-to-end run and fails above 45 seconds, with the machine and worker count that produced the number recorded in a comment. It neither shards nor reconciles — that machinery existed to keep shards honest, and there are no shards. It replaces two hundred lines with about thirty and keeps the one property worth keeping: the suite cannot quietly regrow without the gate going red.

The measured before-and-after figures go on the spec, because the projection of 20 to 25 seconds is an estimate until this ticket runs the number.

**Blocked by:** 02, 03, 04, 05, 07 — every gate conversion, the rig deletion and the worker pin. Without them the run is above the budget by construction.

**Status:** resolved

- [x] One script times the end-to-end suite and exits non-zero above 45 seconds
- [x] The budget constant is declared once, with the machine and worker count it was measured on in a comment
- [x] The full verification gate uses the budget script rather than calling Playwright directly
- [x] A run over budget is proven to fail the gate, not proven by inspection
- [x] The measured wall clock and the measured test-body total are recorded on the spec, beside the figures taken before the work
- [x] The suite is green and under budget on the pinned worker count

## Comments

Implemented. `scripts/e2e-budget.mjs` times one Playwright process and exits non-zero on a failing suite or over `BUDGET_MS = 45_000`; the constant is declared once with the machine, worker count and measurements; `scripts/verify.mjs` step 5 uses it; there is no sharding, retry, reconciliation, flag or env bypass. Over-budget proof: with `BUDGET_MS = 1`, `verify:full` exited 1 with `38.6 s exceeds the 0.001 s budget`; restoring 45 s made runs green again. The checkpoint on the spec records 153 tests, 281.6 s of bodies, 42.6 s. Landed in `965ca57`.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/` in this repo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Verification

`npm run verify` is the fast gate (store, component and backend suites); `npm run verify:full` adds the browser suite.
Tests live at two heights, each free to choose its runner — see `docs/adr/0005-test-policy-two-layers.md`. A browser test needs a wiring claim no store or component test carries — see `docs/adr/0009-wiring-claim-admission-rule.md`.

## Comments

Comments explain **why**: a constraint, a trade-off, a surprise. Never write comments that narrate history (what changed, when, which ticket) or that restate what the code plainly does. No ticket IDs or dates in comments. If a comment only describes the code, delete it and improve the name.

## Style

Be extremely concise when addressing the user unless asked otherwise. Sacrifice grammar for the sake of brevity.

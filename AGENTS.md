## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/` in this repo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Verification

`npm run verify` is the fast gate; `npm run verify:full` adds end-to-end.
Tests live at two heights only — see `docs/adr/0005-test-policy-two-layers.md`.

## Comments

Comments explain **why**: a constraint, a trade-off, a surprise. Never write comments that narrate history (what changed, when, which ticket) or that restate what the code plainly does. No ticket IDs or dates in comments. If a comment only describes the code, delete it and improve the name.

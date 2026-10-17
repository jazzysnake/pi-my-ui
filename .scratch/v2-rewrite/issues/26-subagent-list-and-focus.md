# 26: Subagents: list and focus

**What to build:** Tapping the pill opens a list of main plus each agent's type, name, status and elapsed time; tapping a row focuses that agent and the pill names it. Workflow runs show as their own row. Returning to main is done through the pill.

**Blocked by:** 25 Subagents: the pill

**Status:** resolved

- [ ] E2E: list shows rows with type, name, status and elapsed time
- [ ] Focus changes the pill and returning to main works
- [ ] Workflow run appears as its own row

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

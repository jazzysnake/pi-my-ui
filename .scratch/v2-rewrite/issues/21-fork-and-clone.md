# 21: Fork and clone

**What to build:** /fork creates a new Session from a previous message and /clone copies the active branch to a new Session; the original is unchanged and both appear in the sidebar.

**Blocked by:** 18 Slash palette and session commands

**Status:** resolved

- [ ] E2E: fork from a message produces a new Session, original unchanged
- [ ] Clone copies the active branch
- [ ] Both Sessions listed in the sidebar

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

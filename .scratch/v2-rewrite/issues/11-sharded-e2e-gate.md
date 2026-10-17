# 11: Sharded e2e gate

**What to build:** The whole e2e suite runs sharded so the gate is fast, and the gate fails if any shard fails and accounts for every test. Each shard has its own port namespace.

**Blocked by:** 10 Sessions: list and switch

**Status:** resolved

- [ ] Full suite wall-clock is measured and under one minute at the chosen shard count
- [ ] Gate fails if any shard fails or any test is unaccounted for
- [ ] Wired into `npm run verify`

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

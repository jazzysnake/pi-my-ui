# 11: Sharded e2e gate

**What to build:** The whole e2e suite runs sharded so the gate is fast, and the gate fails if any shard fails and accounts for every test. Each shard has its own port namespace.

**Blocked by:** 10 Sessions: list and switch

**Status:** ready-for-agent

- [ ] Full suite wall-clock is measured and under one minute at the chosen shard count
- [ ] Gate fails if any shard fails or any test is unaccounted for
- [ ] Wired into `npm run verify`

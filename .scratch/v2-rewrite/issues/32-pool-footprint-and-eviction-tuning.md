# 32: Pool footprint and eviction tuning

**What to build:** Default idle timeout and pool behaviour are chosen from measured memory and spawn cost, and the measurements are recorded.

**Blocked by:** 13 Idle eviction and crash recovery, 11 Sharded e2e gate

**Status:** resolved

- [ ] Measured footprint per Pi child recorded
- [ ] Defaults justified by those measurements
- [ ] Idle-timeout default documented

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

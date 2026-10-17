# 03: Fixture builder

**What to build:** Tests can seed real pi session files into a hermetic home from a small committed set of trimmed, sanitised sessions derived from the owner's ges2t sessions (branching, compaction, subagent-heavy, large, plain), plus a generator for extreme shapes (500+ entries, 100-deep tree, many subagent records). Raw sessions are never committed.

**Blocked by:** 02 Real-pi harness with scripted provider

**Status:** resolved

- [ ] Five curated seeds are committed, each small and free of personal content
- [ ] A generator produces a 500+ entry transcript and a 100-deep tree on demand
- [ ] Seeded sessions load in real pi without error
- [ ] A check fails if a raw or oversized session file is staged

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

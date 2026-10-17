# 24: Tree: reveal off-path branch heads

**What to build:** You can tap into an abandoned branch whose head is a single child off the active path, so abandoned work is browsable and not only searchable. Linear paths gain no new toggles and alternatives stay collapsed by default.

**Blocked by:** 23 Tree and branch switching

**Status:** resolved

- [ ] E2E: an off-path single-child head has a reveal control and its subtree can be browsed
- [ ] A linear Session shows no extra toggles
- [ ] Alternatives remain collapsed by default

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

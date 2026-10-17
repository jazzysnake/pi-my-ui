# 27: Subagents: live transcript

**What to build:** A focused live subagent's transcript streams through the same transcript view as the main conversation, delivered via the bridge.

**Blocked by:** 26 Subagents: list and focus

**Status:** resolved

- [ ] E2E: focused running agent's transcript streams live
- [ ] Rendering reuses the main transcript view
- [ ] Transcript survives a resync

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

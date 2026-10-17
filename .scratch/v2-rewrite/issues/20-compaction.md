# 20: Compaction

**What to build:** /compact (from the palette or typed, with optional instructions) shows an in-progress state, then a boundary entry in the transcript. The context-usage readout in the session bar clears afterwards.

**Blocked by:** 18 Slash palette and session commands

**Status:** resolved

- [ ] E2E: in-progress state then boundary entry
- [ ] Context-usage readout clears after compaction
- [ ] Auto-compaction toggle state reflects round trips

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

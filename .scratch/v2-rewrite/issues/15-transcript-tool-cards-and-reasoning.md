# 15: Transcript: tool cards and collapsed reasoning

**What to build:** Tool calls show as cards through running, success and error states, driven by scripted tool calls that real pi executes. Reasoning is collapsed by default.

**Blocked by:** 06 Send a message and stream the reply

**Status:** resolved

- [ ] E2E: scripted tool call shows running then success card
- [ ] Scripted failing tool shows an error card
- [ ] Reasoning collapsed by default and expandable

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

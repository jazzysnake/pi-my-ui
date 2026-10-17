# 19: Bash mode

**What to build:** A message starting with `!` or `!!` shows which mode it is in before sending: `!` adds output to context, `!!` does not. Output streams live in a card with exit code, and the card survives a resync.

**Blocked by:** 17 Composer controls

**Status:** resolved

- [ ] E2E: indicator shows for each prefix before send
- [ ] Live output streams while the command runs
- [ ] Exit code shown; card survives a resync
- [ ] `!!` output never enters model context

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

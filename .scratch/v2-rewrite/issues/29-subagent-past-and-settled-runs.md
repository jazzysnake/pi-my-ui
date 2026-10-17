# 29: Subagents: past and settled runs

**What to build:** Past subagent runs are listed after a server restart. A settled run's conversation opens from its own session file with a clear message when it is gone, unreadable or ambiguous, never showing a different run's conversation. A settled agent with an empty transcript says the run finished.

**Blocked by:** 27 Subagents: live transcript, 03 Fixture builder

**Status:** resolved

- [ ] E2E: after restart past runs are listed
- [ ] Settled run opens its own conversation from disk
- [ ] Missing, unreadable and ambiguous cases each give a distinct honest message
- [ ] Empty settled run says it finished and not no messages yet

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

# 28: Subagents: steering

**What to build:** While a live subagent is focused, sent text steers it. Sending is disabled with a stated reason for settled or queued agents. A steer in flight shows in the status line until pi delivers it.

**Blocked by:** 27 Subagents: live transcript

**Status:** resolved

- [ ] E2E: typed text reaches the focused running agent
- [ ] Disabled state states why for settled and queued agents
- [ ] Pending steer visible then cleared on delivery

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

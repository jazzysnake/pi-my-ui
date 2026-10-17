# 12: Sessions: new and parallel

**What to build:** Start a new Session with the plus control. Start a long run in one Session, switch away and the first keeps working; a dot shows working or unread activity and the background Session's output persists.

**Blocked by:** 10 Sessions: list and switch

**Status:** resolved

- [ ] E2E: plus creates a Session with a server-generated id
- [ ] A background Session keeps running and its output is there on return
- [ ] Activity dot shows working and unread states
- [ ] Two Sessions never share a Pi child

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

# 22: Bridge required

**What to build:** The bridge extension is loaded into every Pi child and connects to the server over a user-only Unix socket with a handshake. If it fails to load or connect, the server fails loudly: no degraded mode (ADR 0003). The bridge never spawns, stops or consumes agents and never writes Session content. A stale socket from a crashed server is handled.

**Blocked by:** 06 Send a message and stream the reply

**Status:** resolved

- [ ] Every Pi child connects its bridge before the Session is usable
- [ ] Failure to load or connect is a loud server error
- [ ] Socket directory and file are user-only; path is never exposed to the browser
- [ ] Stale socket from a crash is detected and handled

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

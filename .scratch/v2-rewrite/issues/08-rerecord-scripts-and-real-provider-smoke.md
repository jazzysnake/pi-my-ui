# 08: Re-record command and real-provider smoke

**What to build:** One command regenerates scripted-provider scripts from a real provider run so scripts cannot drift into fiction, and one opt-in smoke test runs against a real provider (outside the gate).

**Blocked by:** 06 Send a message and stream the reply

**Status:** resolved

- [ ] A single documented command re-records a named script from a real run
- [ ] The smoke test is skipped loudly without credentials and never part of verify
- [ ] Recorded scripts replay identically through the scripted provider

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

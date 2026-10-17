# 04: Protocol and server: a Session's Snapshot over the WebSocket

**What to build:** The server, started for a working directory, serves a seeded Session's Snapshot (Projection plus Cursor) over its WebSocket. The shared `protocol` package defines the contract once: constants with derived types, a runtime validator for every inbound message throwing one typed error, and the single Delta reducer used by both ends. No version constant or negotiation (ADR 0004). Verified through the public WebSocket against real pi.

**Blocked by:** 02 Real-pi harness with scripted provider

**Status:** resolved

- [ ] A WebSocket client receives a correct Snapshot for a seeded Session
- [ ] Malformed or unknown inbound messages are rejected loudly, never coerced
- [ ] The reducer is exported once from protocol and applies Deltas to a Projection
- [ ] The server runs one Pi child for the Session and projects its state

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

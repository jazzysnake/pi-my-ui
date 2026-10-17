# 07: Reconnect and resync

**What to build:** A dropped connection rejoins by itself and the view catches up from its Cursor by Delta replay, or from a fresh Snapshot if the Cursor is unknown. Work continues server-side with no browser connected. Introduces the injected server clock, Playwright's browser clock and the test-only hook that drops viewer connections.

**Blocked by:** 05 Client shell: connect and render the transcript

**Status:** resolved

- [ ] E2E: after a forced drop the dot shows Reconnecting then Connected with no user action
- [ ] Output produced while disconnected appears after reconnect
- [ ] An unknown Cursor yields a fresh Snapshot
- [ ] Backoff is tested with the clock, never by waiting; no fake WebSocket is used

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

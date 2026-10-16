# 07: Reconnect and resync

**What to build:** A dropped connection rejoins by itself and the view catches up from its Cursor by Delta replay, or from a fresh Snapshot if the Cursor is unknown. Work continues server-side with no browser connected. Introduces the injected server clock, Playwright's browser clock and the test-only hook that drops viewer connections.

**Blocked by:** 05 Client shell: connect and render the transcript

**Status:** ready-for-agent

- [ ] E2E: after a forced drop the dot shows Reconnecting then Connected with no user action
- [ ] Output produced while disconnected appears after reconnect
- [ ] An unknown Cursor yields a fresh Snapshot
- [ ] Backoff is tested with the clock, never by waiting; no fake WebSocket is used

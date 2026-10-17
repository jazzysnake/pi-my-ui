# 05: Client shell: connect and render the transcript

**What to build:** Open the app, watch the connection dot go from Connecting to Connected (text on tap/hover), and read a seeded Session's transcript. This introduces the transport module (WebSocket, handshake) behind a plain `ServerMessage` input, and the first store slice (transcript) consuming it.

**Blocked by:** 04 Protocol and server: a Session's Snapshot over the WebSocket

**Status:** resolved

- [ ] E2E: app opens, dot reaches Connected, seeded transcript is visible
- [ ] Store/component test feeds `ServerMessage` objects directly and asserts on rendered output; no socket in that test
- [ ] The transport module is the only code that touches the WebSocket
- [ ] Top bar, transcript area and shell layout render at a phone viewport

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.

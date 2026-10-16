# Two test layers, no tests of internals, no fake WebSocket

Status: accepted

Tests live at exactly two heights: (1) end-to-end through a browser against real pi with the scripted provider (ADR 0002), which also covers the server through its public WebSocket, including reconnect and resync via a real-server connection-drop hook; (2) store and component tests that feed `ServerMessage` objects directly into the client store. A test that cannot be placed at one of these heights means the seam is wrong, not that a third layer is needed. v1's unit tests are deleted, not ported.

The only substitutes in v2 are the scripted model provider (the model is external and non-deterministic) and an injected clock (idle eviction and reconnect backoff cannot be waited out in real time; the browser uses Playwright's `page.clock`). The WebSocket gets no fake: it would only produce cases a real server will not, which is a mock one level down.

v1 had tests 36% larger than source (a 1,566-line test file for a text box) because tests reached past the interface and rebuilt protocol ceremony to assert on rendered state.

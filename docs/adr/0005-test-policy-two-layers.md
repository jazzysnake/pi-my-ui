# Two test layers, no tests of internals, no fake WebSocket

Status: accepted. Amended: the two heights are defined by what is faked, not by which runner runs them.

Tests live at exactly two heights. (1) End-to-end against real pi with the scripted provider (ADR 0002), through the server's public WebSocket, including reconnect and resync via a real-server connection-drop hook. Which runner executes this height is a tooling choice: the Claims that need a browser or a layout engine run under Playwright as the **browser suite**, and the Claims that need only the server, a socket or a Pi child run under vitest in a node environment as the **backend suite**, against the built server. The runner is a tool; the fakes are the rule. (2) Store and component tests that feed `ServerMessage` objects directly into the client store, under vitest in jsdom. A test that cannot be placed at one of these heights means the seam is wrong, not that a third layer is needed. v1's unit tests are deleted, not ported.

The only substitutes in v2 are the scripted model provider (the model is external and non-deterministic) and an injected clock (idle eviction and reconnect backoff cannot be waited out in real time). Each runner chooses its own clock tool: the browser suite uses Playwright's `page.clock`, while the backend suite drives the server's injected clock directly. The WebSocket gets no fake: it would only produce cases a real server will not, which is a mock one level down.

v1 had tests 36% larger than source (a 1,566-line test file for a text box) because tests reached past the interface and rebuilt protocol ceremony to assert on rendered state.

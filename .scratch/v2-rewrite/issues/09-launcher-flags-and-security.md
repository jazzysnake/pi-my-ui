# 09: Launcher, flags and security

**What to build:** The server starts from one command with the carried v1 flag set: cwd, port (default 8787), host (loopback default), idle timeout, keep-alive, repeatable allowed origins, help. Foreign or missing origins are refused and logged with the origin the browser sent. A taken port gives a one-line error. Ctrl-C shuts down cleanly, stopping every Pi child. A health endpoint exists and the server serves no UI. A dev setup makes the real backend reachable from a browser.

**Blocked by:** 04 Protocol and server: a Session's Snapshot over the WebSocket

**Status:** ready-for-agent

- [ ] `--help` lists every flag
- [ ] Origin allowlist enforced on the WebSocket upgrade with a logged refusal
- [ ] Port-taken error names `--port`
- [ ] Shutdown leaves no orphan pi processes
- [ ] Health endpoint answers and the server serves no pages
- [ ] Dev setup reaches real pi from a browser

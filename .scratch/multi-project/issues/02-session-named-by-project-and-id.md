# 02: A Session is named by its Project and its id

**What to build:** The core path — list a Project's Sessions, create one there, open it, prompt it, abort it, and receive its live state — addresses a Session by one composite value pairing its Project with its id, replacing the bare id. Listing Sessions and creating a Session name a Project, and the Sessions response names the Project it lists. The server resolves a Session only inside the named Project: a pair whose Project is not served, or whose id that Project does not hold, is a protocol error, and the server never searches another Project. The pool's id map is keyed by the pair, the absolute Session file stays canonical within its Project, and a connection watches one Project's list and one Session. Only that Project's Sessions, their activity, and that Session's Deltas are pushed to the connection. The Projection stops carrying a working directory; the Project comes from the pair on the message that carries it.

The client routes Snapshot, Delta, Settings, Commands, ContextUsage and session-scoped errors by the pair alone. It selects the Project from `?project=` when the registry serves it, otherwise the only or first Project. There is no picker yet. The remaining Session commands are converted in 03; until then they resolve against the connection's watched Project rather than searching.

**Blocked by:** 01 (the ordered Project registry).

**Status:** claimed

- [ ] One composite Project+id value replaces the bare id on listing, creation, subscribe, prompt, abort and every response on the watched-Session path
- [ ] Listing and creating Sessions name a Project, and a fresh Session is created in that Project
- [ ] The Sessions response names the Project whose list it carries
- [ ] A pair naming an id from another served Project is refused as a protocol error, and nothing is searched
- [ ] The pool is keyed by the pair; a Session file remains canonical within its Project
- [ ] A connection is pushed only its watched Project's Session list and activity
- [ ] A run started in one Project keeps running while another Project is viewed
- [ ] `Ctrl-C` stops every Pi child across every Project
- [ ] The Projection no longer carries a working directory
- [ ] The client store routes the watched-Session messages by the pair alone
- [ ] `?project=` opens that Project when served; otherwise the only or first Project is selected
- [ ] ADR 0007's eviction rule and 120 s window are unchanged, proved by the existing injected-clock eviction specs
- [ ] End-to-end specs cover per-Project listing, creation, opening, prompting, no cross-Project activity, and the rejected cross-Project pair
- [ ] Store and component tests are migrated to the composite identity for the messages this ticket converts

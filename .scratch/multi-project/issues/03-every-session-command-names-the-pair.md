# 03: Every Session command names the pair

**What to build:** Complete the composite identity across the remaining session-scoped commands in both directions: bash, model, thinking level, automatic compaction, compact, statistics, rename, export, fork messages, fork, clone, tree, move leaf, reconnect, subagent steering and subagent transcript, together with the responses they produce. A bare id is no longer accepted anywhere, and the temporary resolution against the connection's watched Project is removed. Fork and clone create their new Session in the same Project, and the client opens it there. Rename refreshes only that Project's list, and export writes inside that Project.

**Blocked by:** 02 (the composite identity and core path).

**Status:** ready-for-agent

- [ ] Every remaining session-scoped request carries the composite Project+id value
- [ ] Every response to those requests echoes the pair
- [ ] A session-scoped message carrying a bare id is refused as a protocol error
- [ ] No Session command can resolve an id outside the Project it names
- [ ] Fork and clone create the new Session in the source Session's Project, and the client opens it there
- [ ] Rename refreshes only the owning Project's Session list
- [ ] Export writes inside the owning Project
- [ ] Tree, move leaf, reconnect, steering and subagent transcript work through the pair
- [ ] The client transport and store send the pair and route every response by it
- [ ] No temporary bare-id path or watched-Project fallback remains
- [ ] End-to-end specs exercise each command group in a served Project
- [ ] Store and component tests are migrated to the pair for every converted message

# 25: Subagents: the pill

**What to build:** The agent pill reads `main`, or a focused subagent's handle, plus a `+N` count of other active agents, now shown on `main` too. This reverses a recorded v1 decision, so a new ADR records it. The harness loads pi-subagents, and a scripted parent turn spawns real subagents served by the scripted provider. Without pi-subagents installed the subagent UI is absent.

**Blocked by:** 22 Bridge required, 15 Transcript: tool cards and collapsed reasoning

**Status:** ready-for-agent

- [ ] E2E: scripted `Agent` call spawns a real subagent and the pill appears
- [ ] `+N` counts other active agents on `main` and when focused
- [ ] New ADR records the reversal of v1's main-shows-no-count decision
- [ ] Without pi-subagents, no pill is shown

# 02: Gate the Subagent scripts

**What to build:** Every Subagent spec that holds a run open with a fixed sleep holds it with a gate instead: steering a running agent, both Subagent pill cases, and the agent list. The scripts stop carrying five- and twelve-second commands, and each test asserts the live state it needs — the agent still running, the pill still counting — before it releases the gate.

The agent list case is the cheapest win in the whole effort: its only claim that needs a live run is a status matching `running|queued`, and its elapsed-time assertion already accepts `0s`, so its fifteen-second command buys nothing.

**Blocked by:** 01 — A harness factory that owns gates, proven on the worst test.

**Status:** resolved

- [x] Steering a focused running agent holds its run with a gate, and the steer still lands at the agent's next step
- [x] Both Subagent pill cases hold their runs with a gate, and the pill still counts a Subagent that is genuinely running
- [x] The agent list case holds its run with a gate, and the row still shows type, name, status and an elapsed reading
- [x] No fixed `sleep` remains in any Subagent spec's script
- [x] Each converted test asserts the state the gate protects before releasing it
- [x] The four cases together cost seconds rather than the current 13.7, 6.9, 6.9 and 15 seconds of scripted waiting
- [x] The suite is green afterwards

## Comments

Implemented. Steering, both pill cases and the agent list hold their runs with `gate(...).command(...)` and observe the live state before `releaseAfter`: the pending steer is visible, the pill reads `main +1`, and the list row reads `running|queued` with an elapsed reading. No fixed sleep remains in the three specs. Durations: steering 15.5→4.3 s, foreground pill 8.8→4.0 s, background pill 8.7→4.1 s, agent list 3.6→4.2 s (its 15 s command no longer leaks into teardown). Landed in `b638444`.

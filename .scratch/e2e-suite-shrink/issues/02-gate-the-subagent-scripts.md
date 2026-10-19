# 02: Gate the Subagent scripts

**What to build:** Every Subagent spec that holds a run open with a fixed sleep holds it with a gate instead: steering a running agent, both Subagent pill cases, and the agent list. The scripts stop carrying five- and twelve-second commands, and each test asserts the live state it needs — the agent still running, the pill still counting — before it releases the gate.

The agent list case is the cheapest win in the whole effort: its only claim that needs a live run is a status matching `running|queued`, and its elapsed-time assertion already accepts `0s`, so its fifteen-second command buys nothing.

**Blocked by:** 01 — A harness factory that owns gates, proven on the worst test.

**Status:** ready-for-agent

- [ ] Steering a focused running agent holds its run with a gate, and the steer still lands at the agent's next step
- [ ] Both Subagent pill cases hold their runs with a gate, and the pill still counts a Subagent that is genuinely running
- [ ] The agent list case holds its run with a gate, and the row still shows type, name, status and an elapsed reading
- [ ] No fixed `sleep` remains in any Subagent spec's script
- [ ] Each converted test asserts the state the gate protects before releasing it
- [ ] The four cases together cost seconds rather than the current 13.7, 6.9, 6.9 and 15 seconds of scripted waiting
- [ ] The suite is green afterwards

# 03: Gate the cross-Project and Session-switching scripts

**What to build:** The four specs that prove a run survives the reader leaving — both "a run keeps working while another Project is viewed" cases, the cross-Project steer case, and the background Session that keeps working while another Session is read — hold their runs with gates instead of ten- and twelve-second commands.

The background-Session case has the largest genuine window in the suite, because returning means starting a second Session's Pi child and waiting for its first reply. It is the case that proves a gate is better than a shorter sleep: the run stays live for exactly as long as the second child takes, however long that is on a loaded machine.

**Blocked by:** 01 — A harness factory that owns gates, proven on the worst test.

**Status:** ready-for-agent

- [ ] Reloading into another Project and returning finds the run still live, and the output produced while away appears when the gate is released
- [ ] Switching Projects in-app does the same, and both cases keep their distinct claims rather than collapsing into one
- [ ] A steer typed while another Project is viewed still reaches the running agent
- [ ] A Session left behind still reports activity while another Session is read, and the activity clears when its output is read
- [ ] Every one of these tests observes the live state before releasing its gate
- [ ] No fixed `sleep` remains in these four scripts
- [ ] The four cases together cost seconds rather than the current 11.7, 11.6, 14.0 and 11.8 seconds of scripted waiting
- [ ] The suite is green afterwards

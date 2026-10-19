# 03: Gate the cross-Project and Session-switching scripts

**What to build:** The four specs that prove a run survives the reader leaving — both "a run keeps working while another Project is viewed" cases, the cross-Project steer case, and the background Session that keeps working while another Session is read — hold their runs with gates instead of ten- and twelve-second commands.

The background-Session case has the largest genuine window in the suite, because returning means starting a second Session's Pi child and waiting for its first reply. It is the case that proves a gate is better than a shorter sleep: the run stays live for exactly as long as the second child takes, however long that is on a loaded machine.

**Blocked by:** 01 — A harness factory that owns gates, proven on the worst test.

**Status:** resolved

- [x] Reloading into another Project and returning finds the run still live, and the output produced while away appears when the gate is released
- [x] Switching Projects in-app does the same, and both cases keep their distinct claims rather than collapsing into one
- [x] A steer typed while another Project is viewed still reaches the running agent
- [x] A Session left behind still reports activity while another Session is read, and the activity clears when its output is read
- [x] Every one of these tests observes the live state before releasing its gate
- [x] No fixed `sleep` remains in these four scripts
- [x] The four cases together cost seconds rather than the current 11.7, 11.6, 14.0 and 11.8 seconds of scripted waiting
- [x] The suite is green afterwards

## Comments

Implemented. The multi-Project harness owns a `Gates` registry and releases it in disposal; its script source accepts a gate builder. The four runs hold with gates and observe before releasing: reload 12.3→2.5 s, in-app switch 12.5→2.4 s, cross-Project steer 15.3→2.8 s, background Session 12.7→3.0 s. No scripted sleep remains in those scripts; reload and in-app switching keep their distinct claims. Landed in `267d366`.

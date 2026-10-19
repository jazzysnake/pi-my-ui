# 04: Gate the remaining scripts

**What to build:** The last fixed sleeps go: the composer's follow-up and steer cases, live Bash output, the tool card that moves from running to success, and the two viewport specs whose commands exist only so that a run is in progress. After this ticket no spec waits a fixed number of seconds for a run to be in a particular state.

The viewport cases are the clearest demonstration of why the number was always wrong: five seconds to guarantee that a run exists at all, when the only requirement is that it has not finished yet.

**Blocked by:** 01 — A harness factory that owns gates, proven on the worst test.

**Status:** resolved

- [x] A follow-up waits until the run finishes because the gate holds it, not because it sleeps
- [x] A steer enters the run at its next step with the run held open by a gate
- [x] Bash mode still streams output live and ends with its exit code, with the command's timing controlled by the test
- [x] A tool card still moves from running to success while the command is held
- [x] The viewport specs keep a run visible for the duration of their assertions without a five-second command
- [x] No fixed `sleep` remains in any scripted command in the suite, except the two abort cases whose long command is never waited for
- [x] The suite is green afterwards

## Comments

Implemented. The composer steer and follow-up, live Bash output, the running→success tool card and both viewport holders now use gates and observe the live state before release. The six targeted specs fell 17.3→14.1 s. Only the two abort cases (`composer-controls` Escape and `send-and-stream` stop) keep a `sleep 30`, and they never wait for it. Landed in `6da4559`.

# 13: Idle eviction and crash recovery

**What to build:** An idle, unwatched Pi child is evicted after the idle timeout and respawns transparently when opened, showing Starting… (not an error). Keep-alive disables eviction. A crashed child shows exit details in the transcript with Reconnect and Resume controls that restore from the intact session file.

**Blocked by:** 12 Sessions: new and parallel, 07 Reconnect and resync

**Status:** ready-for-agent

- [ ] Eviction and respawn tested with the injected clock
- [ ] Starting… is shown and not styled as an error
- [ ] Keep-alive flag disables eviction
- [ ] Crash shows exit code/signal and Reconnect/Resume restores the Session

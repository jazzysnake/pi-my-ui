# The idle window is two minutes, and the pool keeps no more than the window

Status: accepted. Records the default `docs/measurements.md` measured and supersedes v1 ADR 0014's
300 s figure.

An idle, unwatched Session's Pi child costs 183.5 MB resident, and starting a new one from the
Session file costs 862 ms; streaming and running a subagent add 3 to 5 MB to that baseline. The cost
is therefore the number of children kept, not what they are doing, and the idle window is the only
term that turns "kept" into a bounded amount of memory.

The window is **120 seconds**: `--idle-timeout` defaults to 120, and `DEFAULT_IDLE_TIMEOUT_SECONDS` /
`DEFAULT_IDLE_TIMEOUT_MS` are the one place that number lives, read by both the launcher's help line
and the pool. Two minutes keeps a switch away and back warm, which is what a phone user does all day.
Past two minutes the wager flips: 0.86 s of respawn is cheaper than another 183 MB per Session
touched, and a respawn already reads as `Starting…` rather than as a failure.

v1 adopted 300 s by judgement, before anyone had measured a child. Five minutes at today's measured
cost means a user who clicks through the drawer leaves roughly 1.5 GB of idle children running for
five minutes after they stop; two minutes cuts that retention to the sessions touched in the last two
minutes, at the price of an occasional sub-second respawn.

The rules around the window are unchanged (v1 ADR 0014, re-derived in this codebase): only a Session
with no viewer, no run, and nothing queued is evicted; a watched or working Session never is;
`--keep-alive` disables eviction entirely. There is deliberately no cap on how many unwatched children
may be kept: the measured cost is per child, so a count cap would be a new policy rather than a tuning
of this one, and `docs/measurements.md` records the observed ceiling (1.47 GB at eight Sessions) for
whoever sets it.

Cost accepted: a user who returns to a Session more than two minutes after leaving it pays about a
second of `Starting…` before the transcript appears, where a five-minute window would sometimes have
had it warm.

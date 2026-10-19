# Measurements

Numbers this project's defaults are chosen from, each with the command that produced it and the
machine it ran on. Every figure here is a real run of the instrument named beside it; nothing is
estimated.

## Pool footprint and eviction — 2026-10-17

**Command:** `npm run measure:pool`

**Instrument:** `packages/e2e/measure/pool-footprint.measure.ts`. It runs real `pi` (the pinned
version) hermetically with the scripted model provider, real Sessions seated from the committed
fixtures, and the real server over its WebSocket. Resident memory is read from the operating system
per process, not from a runtime's own report. One worker, one measurement at a time.

**Machine:** AMD Ryzen 7 7840HS, 16 CPUs, 27.7 GB RAM, Linux 6.18.52-1-lts, Node v26.9.0,
pi 0.99.2.

| Measurement | Result |
| --- | --- |
| One idle Pi child (`pi --mode rpc`, bridge loaded) | 183.5 MB resident |
| The same child streaming a 15 KB reply | 186.4 MB peak (+2.9 MB) |
| The same child running a subagent | 188.8 MB peak (+5.4 MB, still one `pi` process) |
| Cold start to a served Session (spawn, bridge handshake, seed) | 900 ms |
| Respawn after eviction, from the Session file | 862 ms |
| 8 watched Sessions | 1 468 MB of children (183.5 MB each) |
| After all 8 were evicted | every child's memory returned to the OS |

Two runs of the full set agreed to within a megabyte per child and 40 ms on the start figures.

**What the numbers say.** A child's cost is dominated by having a `pi` process at all: streaming and a
subagent add 3–5 MB to a 183 MB baseline. Starting one again costs under a second and is shown as
`Starting…`, not as an error. So the pool's footprint is decided by how many unwatched children are
kept and for how long, not by what those children are doing.

**The ceiling.** Eviction is what bounds the pool, and it only ever takes a child nobody watches and
nothing is running in. With a 120 s window, the retention cost is (Sessions left unwatched in the last
two minutes) × 183 MB; the observed ceiling at 8 concurrently opened Sessions is 1.47 GB, all of which
the idle window returns. An unwatched child that a connected viewer's disconnect failed to detach is
the one state that never comes back — `packages/e2e/backend/pool-defaults.spec.ts` covers it.

**Per Session, not per child.** Inside the server the only state that grows with a Session is what the
Session itself contains: the projected transcript (one entry per entry pi wrote). Bash executions are
transcript entries like any other, so there is no separate per-command record to grow; the stress run
above opened Sessions with 60 entries each and returned to its starting footprint after eviction.
Retained Deltas have code bounds rather than measured ones, so they are not claimed here.

## The suite before the split — 2026-10-17

**Command:** a full `playwright test` run of the suite as it then stood, once per worker count: 4, 8
and 12. The worker count was a variable of the measurement rather than a pinned setting, so the
runs below are what the same suite cost at three concurrency levels, not what `npm run test:e2e`
runs today. Today that command runs the browser suite only, at the pinned eight workers.

**Instrument:** Playwright's own wall clock from spawn to exit, over the suite as it stood before the
shrink (169 tests, 361.6 s of test bodies). The figures below are that before-state, measured on the
same machine with the same suite so the worker count is the only variable.

**Machine:** AMD Ryzen 7 7840HS, 16 CPUs, 27.7 GB RAM, Linux 6.18.52-1-lts, Node v26.9.0,
pi 0.99.2.

| Run | Workers | Wall-clock |
| --- | --- | --- |
| Full suite, before the shrink | 4 | 109 s |
| Full suite, before the shrink | 8 | 67 s |
| Full suite, before the shrink | 12 | 56.4 s |

**Why eight.** Wall-clock stops improving where the cores run out: four workers cost 42 s more than
eight, and twelve buy 10.6 s more by filling all 16 cores, which leaves nothing for the host, the
browser processes or concurrent agent work, and makes the timing-sensitive streaming specs fail
under load rather than on behaviour. Eight is the knee, and pinning the count rather than
inheriting a share of whatever host the run lands on is what makes the budget a fixed number. A
smaller machine oversubscribes at eight and will not reproduce these figures.

## The suite after the gates and the worker pin — 2026-10-19

**Command:** `npm run test:e2e`, which is `scripts/e2e-budget.mjs`: one Playwright process at the
worker count pinned in `packages/e2e/playwright.config.ts`, timed from spawn to exit and failing
above the 45-second budget declared in that script. At this checkpoint the suite still held both
halves; after the runner split it is the browser suite.

**Instrument:** the budget script's own stopwatch for wall clock, and the sum of every test's
`results[].duration` from a `--reporter=list,json` run for the body total. Nothing here is
estimated.

**Machine:** AMD Ryzen 7 7840HS, 16 CPUs, Node v26.9.0.

| Run | Tests | Test bodies | Wall-clock at 8 workers |
| --- | --- | --- | --- |
| Full suite, before the shrink | 169 | 361.6 s | 67 s |
| After the gates, the rig deletion and the worker pin | 153 | 281.6 s | 42.6 s (41.5 s Playwright-reported; 38.6 s on a second run) |

The spread between the two checkpoint runs is about four seconds at eight workers, which is why the
budget sits above the slower of them rather than on it: a gate that fails on load teaches nothing
about the suite.

## The runner split — 2026-10-19

**Command:** `npm run test:e2e` for the browser half, which is `scripts/e2e-budget.mjs`; and
`npm run test --workspace @pi-my-ui/e2e` for the backend half, which is one `vitest run`.

**Instrument:** the budget script's own stopwatch for the browser wall clock and Playwright's JSON
`stats.duration` for the same run, with the body total summed from every test's
`results[].duration`. The backend figure is vitest's own duration for one run. The backend specs
import `@pi-my-ui/server` through its `import` export, so they run against `packages/server/dist`,
the same built tree the browser half exercises.

**Machine:** AMD Ryzen 7 7840HS, 16 CPUs, Node v26.9.0, one-minute load 2.95 before the JSON run.

| Run | Tests | Test bodies | Wall-clock |
| --- | --- | --- | --- |
| Browser half, before the split (Playwright) | 125 | not re-measured | 37.1 s (last integration run); 39.8 s locally just before the move |
| Browser suite, after the split (Playwright) | 85 | about 202 s | 29.6–34.4 s at 8 workers across runs; 29.5 s in the final full gate, 29.9 s through the budget wrapper |
| Backend suite, after the split (vitest, node) | 40 | not measured | 14.3 s (15.7 s on a second run); about 13.2 s inside the final full gate |

The browser suite itself is unchanged by the move: the same surviving specs, the same import depth,
and the same runner settings. Its wall clock falls because the 40 page-less tests left for the
backend suite, not because the browser tests got faster. The budget stays at 45 s, which the
browser suite now meets with about 15 s to spare, while the fast gate pays the backend suite's
parallel run in exchange for coverage that no longer needs a browser.

The browser wall clock spans 29.5 s to 34.4 s over identical work, so the spread is the machine
rather than the suite: the slowest of those runs overlapped other work and the fastest ran on an
idle box. That is why the budget sits above the slowest of them rather than on the fastest.

## What these numbers set

- **Eight workers** (`packages/e2e/playwright.config.ts`). The knee of the wall-clock curve above:
  four workers cost 42 s more, and twelve save only 10.6 s more by filling the box.
- **Idle window: 120 s** (`DEFAULT_IDLE_TIMEOUT_SECONDS`, `docs/adr/0007-idle-window-and-pool-footprint.md`).
  Two minutes keeps the common switch away and back warm; past that, a 0.86 s respawn is cheaper than
  another 183 MB held per Session touched.
- **`--keep-alive` stays a flag rather than a default.** Pinning every child would hold 183 MB per
  Session ever opened, which the measurements make concrete.
- **No cap on the number of kept children beyond the window.** The measured cost is per child, so any
  count cap would be a new policy decision, not a tuning of this one; the ceiling above is recorded so
  that decision has numbers to start from.

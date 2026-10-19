# 01: A harness factory that owns gates, proven on the worst test

**What to build:** One shared harness factory that owns everything a single test starts — the hermetic home, the server, the client page server and any gate files — and disposes of all of it, releasing every gate it handed out. Alongside it, the gate: a file whose absence blocks a scripted Bash command and whose creation releases it, with an absolute path derived from the per-test hermetic root, outside the served Project, a bounded poll, and an idempotent release. One spec converts as proof of the whole mechanism: the Subagent transcript case that resyncs while the focused agent is still working, today the 21.9-second floor of the suite.

The helper's contract records the rule that makes a gate different from a sleep: a test may release only after it has observed the state the gate protects. Releasing first turns the gate into a race that always passes.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] One harness factory replaces the per-spec start-and-dispose pairs in every spec it touches, and every spec it does not touch still compiles and passes
- [x] A gate's path comes from the per-test hermetic root and is absolute, so two workers and two gates in one test cannot collide
- [x] A gate never appears inside a served Project, so no file-panel, tree or listing assertion can see it
- [x] Disposal releases every gate the factory handed out, including when an assertion failed before the test released it
- [x] The blocked command's poll is bounded and its tool timeout is longer than that bound, so a leaked gate degrades to a timeout rather than a hang
- [x] The gate's contract documents observe-then-release, and the converted spec releases after asserting the agent is still running
- [x] The Subagent transcript resync case holds its run with a gate instead of a 20-second command, and still asserts that the later agent output reached the same rows after the resync
- [x] That test's duration falls from roughly 22 seconds to a few, and the whole suite is green afterwards

## Comments

Implemented. The gate helper is `packages/e2e/src/gate.ts` and the single-test factory is `packages/e2e/src/test-harness.ts`. A gate file is absolute under `<hermetic root>/gates/<n>-<name>` and outside every served Project; the blocked command polls for 30 s and its Bash tool timeout is 60 s; `dispose()` releases every gate before closing the server and home, including after a failed assertion. The only test-facing release is `releaseAfter(observe)`; the public surface is `harness.gate(name)`, and the teardown release is internal. The Subagent transcript resync case fell from ~21.9 s to 2.5–3.9 s while still asserting the later agent output reached the same rows. Landed in `f6d6082`.

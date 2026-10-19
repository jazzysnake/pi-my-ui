Status: ready-for-agent

# A suite that earns its wall clock

Vocabulary is `GLOSSARY.md`; the test-height decision is `docs/adr/0005-test-policy-two-layers.md` and the oracle decision is `docs/adr/0002-real-pi-with-scripted-provider-is-the-oracle.md`. This spec amends 0005 and records a new admission rule; where this spec and an ADR disagree after that amendment lands, the ADR is right and this is the bug.

## Problem Statement

I run the full gate constantly — after most changes, and always through an agent — and the end-to-end suite is the part I pay for: 67 seconds on a 16-core machine, 169 tests, 361 seconds of test bodies. Worse than the number is what the number is made of. A third of the tests never open a browser: they start the server in-process and drive its WebSocket, which is backend work wearing the browser runner. Sixteen test the test rig — the harness, the fixture builder, the recorder, the lint scripts — so the suite spends real-Pi prices asserting that the machinery which runs the suite works. Several of the longest tests are long because their scripted Bash command contains `sleep 10` or `sleep 20`, numbers raised until they stopped flaking and never lowered. Reading the suite therefore tells me what someone once checked, not what the product promises: for a single feature I find a spec file, a store test file, and often three near-identical variants of one rule, and I cannot tell which of the three I would be allowed to delete.

## Solution

Keep the browser suite, make it small, and make it fast. A browser test stays only if it carries a wiring claim no store or component test carries — a claim that needs a real Pi child, a real socket, or a real layout engine behind it. Everything else moves down or goes. Fixed sleeps become gates the test opens when it is ready, so a test that must observe a live run is fast and deterministic instead of slow and lucky. The rig stops being tested by the suite that the rig runs. The backend tests — the ones that never open a page — keep their height and their real Pi children but move to the runner they belong under: one package, two sibling directories, the browser specs under Playwright and the backend specs under vitest against the built server. The gate is pinned to eight workers, one process, one honest stopwatch that fails over 45 seconds because a budget nothing enforces is a wish.

## User Stories

### The gate I pay for
1. As the owner, I want the full end-to-end gate under 45 seconds on my machine, so that running it after every change stays affordable.
2. As the owner, I want the gate to fail when it exceeds 45 seconds, so that the suite cannot quietly regrow and rob me later.
3. As the owner, I want the run to take a fixed number of workers rather than a share of whatever machine it lands on, so that two machines produce comparable numbers.
4. As the owner, I want one process instead of shards, so that the total is one run's number rather than three shards plus arithmetic.
5. As the owner, I want the shard script and its reconciliation gone, so that there is one gate to keep honest instead of two.
6. As an agent, I want a red gate to arrive in under a minute, so that a fix loop iterates on behaviour rather than on waiting.
7. As the owner, I want no test to hang for two minutes on a dead child, so that a broken run fails in 45 seconds rather than 120.
8. As the owner, I want the number I quote to come from a comment that says which machine and how many workers produced it, so that the next person can tell whether it still applies.

### A suite that says what it promises
9. As a reviewer, I want every surviving browser test to name a claim only a real stack can hold, so that I can tell why each one exists without reading the whole file.
10. As a reviewer, I want the admission rule written down, so that "why is there no end-to-end test for this?" has an answer that is not my memory.
11. As a reviewer, I want the same rule applied to a candidate deletion, so that cuts are decisions rather than taste.
12. As a reviewer, I want a store test to be the obvious home for a rendering rule, so that the browser suite stops restating what jsdom already proves.
13. As a reviewer, I want two tests that make different claims about one promise to both survive, so that "reload" and "switch in-app" are not collapsed into one weaker test.
14. As the owner, I want an over-capacity browser suite to be a visible smell again, so that the next feature cannot add three specs by default.

### Behaviour that has to keep working
15. As a phone user, I want the reconnect promise still covered end to end, so that a dropped connection never reaches me as lost output.
16. As a phone user, I want a focused Subagent's conversation still covered across a reconnect, so that a drop does not silently strand me on a frozen copy.
17. As a phone user, I want a run that continues while I look at another Session or another Project still covered, so that switching views stays free of consequences.
18. As a phone user, I want steering a running agent still covered end to end, so that the one thing I do most on a phone keeps working.
19. As a phone user, I want layout, touch-target size and viewport containment still covered in a real browser, so that the phone-first promise is checked by something with a layout engine.
20. As a phone user, I want the file panel's containment rules still covered, so that serving several Projects never widens what a page can read.
21. As the owner, I want the Bridge's failure modes still covered, so that a required component cannot regress into an optional one.

### Tests that are fast because they are exact
22. As a test author, I want to hold a run open until my test is ready, so that I never pick a sleep long enough to be safe on a loaded machine.
23. As a test author, I want releasing the gate to be one call, so that the mechanism does not leak into every assertion.
24. As a test author, I want a gate to be per-test by construction, so that parallel workers cannot release each other's runs.
25. As a test author, I want a gate outside the served Project, so that the file panel and the tree never see it.
26. As a test author, I want a gate reached by absolute path, so that a Bash command running in a Subagent's directory blocks on the same file.
27. As a test author, I want a failed assertion to release its gate during teardown, so that a red test does not sit on a dead run.
28. As a test author, I want the helper to forbid releasing before observing, so that a gate cannot degrade into a sleep with nicer spelling.
29. As a test author, I want a bounded wait even if a gate is never released, so that a bug in my test cannot hang the suite.
30. As a test author, I want the assertion that the run is live to come before the release, so that the test proves liveness instead of assuming it.

### Backend behaviour under the backend runner
31. As a server contributor, I want the server's public WebSocket behaviours tested by the runner that suits them, so that I am not paying for a browser I never open.
32. As a server contributor, I want those tests in the same package as the harness they need, so that no test-only package has to be invented to hold them.
33. As a server contributor, I want them to run under `npm test`, so that they run while I write server code rather than only in the full gate.
34. As a server contributor, I want them to exercise the built server, so that the runner and the browser suite can never disagree about which server they tested.
35. As a contributor, I want the browser specs and the backend specs in sibling directories at equal depth, so that moving them changes no imports.
36. As a contributor, I want the package to keep its name, so that the change touches coverage rather than labels.

### The rig stops testing itself
37. As a contributor, I want the suite to stop asserting that the harness works, so that a suite of tests is not also a suite of tests of the tests.
38. As a contributor, I want a broken seed to fail the spec that seeds it, so that seed validity is proven by use rather than by a dedicated test.
39. As a contributor, I want the lint scripts watched by the gate that runs them, so that a gate test is not the only evidence a gate exists.
40. As a contributor, I want the recorder's round-trip watched only if recordings are still being added, so that dead tooling does not own 3 tests in perpetuity.

### Vocabulary and decisions
41. As a future contributor, I want Journey, Claim and Wiring claim defined in `GLOSSARY.md`, so that the admission rule can be stated and argued with.
42. As a future contributor, I want the two heights stated as "two heights, each free to choose its runner", so that the runner is a tool and the fakes are the rule.
43. As a future contributor, I want a decision record for the admission rule, so that the next "there should be an e2e test for this" is answered by a document.
44. As the owner, I want the plan's measured before-and-after numbers kept beside the spec, so that the next person can tell whether 45 seconds was ever real.

## Implementation Decisions

**Admission rule.** A browser test survives only if it carries at least one **wiring claim** — a claim whose truth needs a real Pi child, a real socket, a real browser, or a real layout engine behind it — and no store or component test already carries that same claim. A **Claim** is one sentence the test fails on if it turns false. A **Journey** is a path a user takes across a seam, named by its outcome, and it is one reason a test exists rather than the only one: two tests may cover one journey when they make different wiring claims, as reloading a Project and switching to it in-app do. The rule is applied to the whole browser suite, not to new tests only.

**Rig deletion.** Every test whose subject is the test rig is deleted, not moved: the harness's own isolation tests, the fixture builder's seed and generator tests, the recorder's round-trip tests, and the tests of the repository's lint scripts. Seed validity and harness health become implicit in the specs that seed Sessions and start Pi children, which is where a break actually shows. The recorder's round-trip stops being watched, which is accepted: recordings are a tool, not a promise.

**Gates.** A fixed sleep in a scripted Bash command is replaced by a gate: a file whose absence blocks the command and whose creation releases it. The helper lives with the harness and returns both the absolute path and a `release()` that is idempotent. Five invariants hold: the path is derived from the per-test hermetic root, so parallel workers cannot collide; it is absolute, so a command in any working directory resolves the same file; it lies outside the served Project, so no file-panel or tree assertion can see it; `release()` is called from the harness teardown so a failed assertion still frees the run; and the poll is bounded, so a leaked gate degrades to a timeout rather than a hang. The ordering rule is part of the helper's contract: a test may release only after it has observed the state the gate protects — releasing first turns the gate into a race that always passes. Every command that blocks on a gate sets a tool timeout above the poll bound.

**Which sleeps become gates.** Every scripted command that holds a run open for the browser: the Subagent transcript and steering cases, the Subagent pill cases, the Subagent list case, the background-Session case, both cross-Project run cases, the cross-Project steer case, the composer's follow-up and steer cases, the Bash-mode streaming case, the tool-card progress case, and the viewport cases that merely need a run to exist. The tests that abort a run (`Escape`, stop) keep their long command because they never wait for it to finish; they are not gates.

**One test returns.** The Subagent transcript's resync case was deleted as a 21.9-second floor while its sleep still stood. Gated it is roughly two seconds and it makes a wiring claim nothing else makes — that a focused Subagent's conversation survives a reconnect — so it returns.

**Runner split.** The e2e package keeps its name and its harness, and gains two sibling directories at equal depth: the browser specs under Playwright, the backend specs under vitest with a node environment. Equal depth is deliberate — no import in any moved spec changes. Playwright's `testDir` points at the browser directory; the vitest configuration includes only the backend directory. The package gains a `test` script, so the root `npm test --workspaces` picks the backend half up with no other wiring. The backend specs run against the built server rather than against source, so both runners exercise one code path; the type-level source condition in the package's TypeScript configuration is unchanged and unrelated to runtime.

**Gate ordering.** The root verify runner builds before it runs tests, so the backend specs find the built server, the built Bridge extension and the built scripted provider, and the launcher specs find the built CLI. No package gains a pre-test build. The fast gate therefore grows by the backend suite's parallel run plus nothing else.

**Workers and budget.** The Playwright configuration pins eight workers and states why. The sharded runner script and its npm script are deleted; the full gate calls the end-to-end script directly. A small budget script replaces it: it times a normal end-to-end run and exits non-zero above 45 seconds, with the measurement conditions in a comment. It does not shard, retry, or reconcile — that machinery existed to make shards honest, and there are no shards.

**Timeouts.** One per-test timeout of 45 seconds lives in the harness rather than in eleven per-file declarations. It is roughly four times the slowest real path after gating, so it will not flake, and a hang costs 45 seconds instead of 120.

**Explicitly unchanged.** The real Pi child with the scripted provider remains the oracle. The hermetic home, the port namespace, the seeded Sessions, the Bridge and the browser bundle under test are untouched. There is no fake WebSocket and no third height. The product's behaviour does not change: this is a test-suite change and nothing else.

## Testing Decisions

A good test asserts an observable outcome and nothing about how it was produced. In the browser suite that means the rendered transcript, the composer, the drawer, the file panel and the layout a browser computes — never a component's internals, never a hand-built protocol sequence. In the backend suite it means the messages a real WebSocket client receives and the process facts a real server produces — never the pool's internals, never the Projection's private shape. In the store suite it means rendered output from fed `ServerMessage` values. Prior art for all three is what exists today: the browser specs drive the built bundle through the client page server; the backend specs already connect a real client to a real server with real Pi children; the store specs already feed typed messages into the store mounted under jsdom.

**No new seam.** The browser suite and the store suite are ADR 0005's two heights; the backend suite is the existing WebSocket entrance to the first height, unchanged in height and fakes, only in runner. That nothing new is needed is the signal that the boundary is right.

**Browser suite after the walk.** The seven journeys remain the map — open, choose and send; Subagents; reconnect and resync; Session switching and Project isolation; phone layout and touch; files; launch and shutdown. Each surviving test carries a claim from that map or it does not survive. The cuts concentrate where a store test already holds the claim: the composer's model and effort pickers (dismissal, exclusivity, a chosen row applying once), the Project picker's notice variants, the message tree's collapsed-branch rendering, and the tool card's folded output.

**Backend suite after the move.** The launcher's flag and refusal cases, the Bridge's socket and failure cases, the protocol's Snapshot, resync and malformed-frame cases, the Session-pool's idle-window and eviction-window cases, the file containment and traversal cases, and the cross-Project refusal cases. They assert the same things they assert today; only the runner, the directory and the resolution of the server change.

**The gate helper is itself a testing decision.** Its release-ordering invariant is what separates it from a sleep, so it is documented in the helper and honoured in every call site: observe, then release, then wait for the outcome.

**Verification of the change itself.** The suite is measured before and after on the same machine with the same worker count, and the two numbers are recorded beside this spec. The budget script is proven by running it against a run that exceeds the budget, not by inspection.

## Out of Scope

- Renaming the e2e package; the browser suite keeps a package name that predates it being browser-only.
- Sharding, distributed runs, or any parallelism beyond one process with a pinned worker count.
- A fake WebSocket, a fake Pi child, or any third test height; ADR 0005 forbids them and this spec does not reopen that.
- Coverage thresholds, mutation testing, or a coverage report as a substitute for the admission rule.
- jsdom-based layout assertions; layout claims stay in the browser by definition.
- Restructuring the client's store and component suite, which is the destination for moved claims but not itself under review.
- Any product behaviour change, including the reconnect backoff, the eviction window, the idle pool, or the Bridge's requirements.
- The pool-footprint measurement, the capture configuration and the credentialed smoke suite; they are outside the gate and stay as they are.
- A CI matrix across machine sizes; the pinned worker count is chosen for the developer machine and recorded rather than tuned per environment.

## Further Notes

**Measured before, on this machine (16 cores, Node 26).** 169 tests, 361.6 seconds of test bodies. Wall clock: 109 seconds at 4 workers, 67 seconds at 8, 56.4 seconds at 12. Three shards of four workers: 66 seconds. Sum of the six slowest tests: 84.8 seconds. Sum of the 52 page-less tests: 55.8 seconds. Sum of the 16 rig tests: 16.7 seconds. Sum of the fixed sleeps above ten seconds, plus the five-second and smaller ones: roughly 102 seconds. Per-test runner overhead is negligible: sixty empty Playwright tests complete in 1.3 seconds.

**Measured after, at the checkpoint after the gates, the rig deletion and the worker pin (AMD Ryzen 7 7840HS, 16 CPUs, Node v26.9.0, the config's pinned eight workers).** 153 tests, 281.6 seconds of test bodies, counted by summing every test's `results[].duration` in a `--reporter=list,json` run. Wall clock: 42.6 seconds from spawn to exit through `npm run test:e2e`, which is now the budget script's own stopwatch (Playwright reported 41.5 seconds for the same run; a run under the same conditions a few minutes later took 38.6 seconds, so the run-to-run spread is about four seconds and the one-minute load at the start was 2.9). Against the before figures — 169 tests, 361.6 seconds of bodies, 67 seconds at eight workers — the gates and the rig deletion bought 16 tests, 80 seconds of bodies and 24 seconds of wall clock, and no browser test carrying a wiring claim was deleted to get there. Headroom against the 45-second budget is 2.4 seconds, so the suite holds the budget but tightly; the 40 page-less tests (49.2 seconds) and the 27 cut browser tests (34.6 seconds) are still inside this number, which is what the admission walk and the runner split remove.

**Projected after.** Roughly 85 browser tests carrying wiring claims, about 120 seconds of test bodies, 20 to 25 seconds of wall clock at eight workers. The projection is an estimate until the gates and the deletions land; the budget script is what turns it into a fact.

**Ordering.** Gates first, because they are the largest and safest win and their numbers are measurable alone; then the rig deletion, the worker pin, the budget script and the timeout; then a measurement checkpoint; then the admission walk, with the keep and cut list reviewed before anything is deleted; then the runner split, which is churn and belongs last; then the documentation.

**Risks worth knowing.** The backend suite needs the built Bridge extension, the built scripted provider and the built CLI, which is why verify must build before it tests; without the reorder the move fails in a confusing place. Deleting the recorder's tests leaves `npm run rerecord` unwatched. Deleting the fixture-builder tests makes seed validity implicit in the specs that seed Sessions, which is intended but is a smaller safety net. Pinning eight workers is right for this machine and would oversubscribe a smaller one, which the comment must say.

**Deferred.** Publication of the implementation issues and the measured comment on this file happen when work starts, not now.

## Comments

# 09: The admission walk

**What to build:** Every remaining browser test is judged against the rule and either kept or deleted, with the keep-and-cut table reviewed before anything is removed. A test survives only if it carries a wiring claim — a claim that needs a real Pi child, a real socket, a real browser or a real layout engine behind it — that no store or component test already carries. Two tests may cover one journey when their claims differ, which is why reloading into a Project and switching to it in-app both survive.

The cuts are expected to land on the composer's model and effort pickers, the Project picker's near-identical notice variants, the message tree's collapsed-branch rendering, and the tool card's folded output — each already carried by a store or component test. Nothing is deleted for being slow: the gates have made that a non-argument.

**Blocked by:** 02, 03, 04 — the keep-and-cut table quotes costs measured after the gates, so the sequence must be gates first.

**Status:** resolved

- [x] Every surviving browser test names, in its own words, the wiring claim it carries
- [x] Every deleted browser test names the store or component test that already carries its claim
- [x] The keep-and-cut table is reviewed before any deletion happens
- [x] The composer's picker mechanics are represented by store tests rather than by browser tests
- [x] One Project picker variant survives and the rest are carried at the store level
- [x] The message tree's rendering rules are carried at the store level, with the browser keeping the wiring claim about pi confirming a Leaf move
- [x] Every one of the seven journeys still has at least one browser test
- [x] The suite is green with the reduced set, and the measured saving is recorded

## Comments

Implemented from the reviewed table in `.scratch/e2e-suite-shrink/admission-walk.md`: 85 browser tests kept and 28 cut — the 29 proposed cuts minus the two review keeps (sessions drawer metadata, the failing tool card), plus the message-tree 100-deep test after its depth cap moved to `message-tree.test.ts`. Seven store/component tests were added first: four composer picker rules, empty-Project state, connection-label reveal, and the 100-deep depth cap. Every survivor carries a `// Wiring claim:` comment (85); every cut names the store/component test that carries its claim. Playwright went 153→125 tests and 41.5→38.4 s; the browser suite went 113→85 tests. All seven Journeys retain a browser test. Landed in `604e3d1`.

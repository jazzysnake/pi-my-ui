# 05: Delete the rig tests

**What to build:** Every end-to-end test whose subject is the test rig is deleted: the harness's own isolation tests, the fixture builder's seed and generator tests, the recorder's round-trip tests, and the tests of the repository's lint scripts. Any harness helper that only those tests used goes with them.

The rig stops being tested by the suite the rig runs. Seed validity becomes implicit in the forty-odd specs that seed Sessions and fail loudly on a broken one; harness health becomes implicit in every spec that starts a Pi child. The lint scripts remain watched by the gate that runs them on every verification. Deleting the recorder's tests leaves the rerecord script unwatched, which is accepted: recordings are a tool, not a promise.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The harness isolation tests, the fixture builder tests, the recorder tests and the lint-script tests are gone
- [x] No harness helper survives with no caller
- [x] Seed validity is still caught by use: a deliberately broken seed fails a spec that seeds it
- [x] The lint scripts are still exercised by the verification gate that runs them
- [x] The suite is green with sixteen fewer tests
- [x] The measured saving is recorded: roughly seventeen seconds of test bodies

## Comments

Implemented. Deleted the four rig specs (`pi-harness`, `fixture-builder`, `recorded-scripts`, `gates` — 16 tests) and the now-callerless `packages/e2e/src/recorded-scripts.ts`; the list went 169→153 tests. Seed validity by use: truncating `fixtures/seeds/plain.jsonl` made `subagent-transcript.spec.ts` fail with `SyntaxError: Unterminated string in JSON`; the restored file is byte-identical. The lint scripts remain exercised by `npm run lint` in the gate. Measured saving is about 55 s of test bodies and 17.3 s of wall clock — the ticket's "17 seconds of bodies" was wall clock. Landed in `36213bd`.

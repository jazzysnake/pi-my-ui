# 06: One 45-second test timeout

**What to build:** A single per-test timeout declared once in the harness, replacing the eleven per-file declarations of two minutes. Forty-five seconds is roughly four times the slowest real path in the suite after the gates land, so it will not flake, and a genuine hang costs 45 seconds of wall clock instead of 120.

This is safe to land before the gates: the current worst case is the 21.9-second Subagent transcript test.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] One timeout declaration exists in the harness and the per-file two-minute declarations are gone
- [x] Every spec runs under the shared timeout, including the ones that declare their own test data
- [x] A deliberately hanging test fails in 45 seconds rather than 120
- [x] The suite is green at the new bound

## Comments

Implemented. One `BROWSER_TEST_TIMEOUT_MS = 45_000` is declared in `packages/e2e/src/test-timeout.ts` and imported by `packages/e2e/playwright.config.ts`; all 40 per-spec timeout declarations were removed. A deliberately hanging probe failed at 45.0 s (`Test timeout of 45000ms exceeded`), not 120 s. The opt-in credentialed smoke suite keeps its own longer bound, as the spec's Out of Scope says. Landed in `f5941f7`; the declaration moved into the harness in review fix `0b0b28e`.

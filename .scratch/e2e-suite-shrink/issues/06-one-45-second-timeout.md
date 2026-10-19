# 06: One 45-second test timeout

**What to build:** A single per-test timeout declared once in the harness, replacing the eleven per-file declarations of two minutes. Forty-five seconds is roughly four times the slowest real path in the suite after the gates land, so it will not flake, and a genuine hang costs 45 seconds of wall clock instead of 120.

This is safe to land before the gates: the current worst case is the 21.9-second Subagent transcript test.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] One timeout declaration exists in the harness and the per-file two-minute declarations are gone
- [ ] Every spec runs under the shared timeout, including the ones that declare their own test data
- [ ] A deliberately hanging test fails in 45 seconds rather than 120
- [ ] The suite is green at the new bound

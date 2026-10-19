# 10: Runner split — browser and server siblings

**What to build:** The specs that never open a page move under the runner that suits them. The e2e package keeps its name and its harness, and gains two sibling directories at equal depth: the browser specs under Playwright, the backend specs under vitest with a node environment. Equal depth is deliberate, so that no import in any moved spec changes. The package gains a test script, so the root test command picks the backend half up with no other wiring.

The backend specs run against the built server, so both runners exercise one code path and cannot disagree about which server they tested. The verification gate builds before it tests, so the backend half finds the built server, the built Bridge extension, the built scripted provider and the built launcher CLI. No package gains a pre-test build. The e2e style checker's scan root, the smoke configuration and the package's TypeScript include list follow the move.

**Blocked by:** 05 — the rig tests are gone, so nothing dead is relocated; 09 — the browser set is final, so the split moves only survivors.

**Status:** ready-for-agent

- [ ] The browser specs and the backend specs live in sibling directories at equal depth
- [ ] No import in any moved spec changed, because the depth did not change
- [ ] Playwright's test directory points at the browser half and its smoke configuration follows
- [ ] A vitest configuration includes only the backend half with a node environment
- [ ] The package's test script runs the backend half, and the root test command runs it without new wiring
- [ ] The backend half imports the built server, not its source
- [ ] The verification gate builds before it runs tests, and every backend spec finds the built Bridge extension, scripted provider and launcher
- [ ] The style checker scans the browser directory rather than the old one
- [ ] No test-only package was invented to hold the harness
- [ ] Both halves are green, and the browser half's wall clock is unchanged by the move

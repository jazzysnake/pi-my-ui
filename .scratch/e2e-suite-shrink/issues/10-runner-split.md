# 10: Runner split — browser and server siblings

**What to build:** The specs that never open a page move under the runner that suits them. The e2e package keeps its name and its harness, and gains two sibling directories at equal depth: the browser specs under Playwright, the backend specs under vitest with a node environment. Equal depth is deliberate, so that no import in any moved spec changes. The package gains a test script, so the root test command picks the backend half up with no other wiring.

The backend specs run against the built server, so both runners exercise one code path and cannot disagree about which server they tested. The verification gate builds before it tests, so the backend half finds the built server, the built Bridge extension, the built scripted provider and the built launcher CLI. No package gains a pre-test build. The e2e style checker's scan root, the smoke configuration and the package's TypeScript include list follow the move.

**Blocked by:** 05 — the rig tests are gone, so nothing dead is relocated; 09 — the browser set is final, so the split moves only survivors.

**Status:** resolved

- [x] The browser specs and the backend specs live in sibling directories at equal depth
- [x] No import in any moved spec changed, because the depth did not change
- [x] Playwright's test directory points at the browser half and its smoke configuration follows
- [x] A vitest configuration includes only the backend half with a node environment
- [x] The package's test script runs the backend half, and the root test command runs it without new wiring
- [x] The backend half imports the built server, not its source
- [x] The verification gate builds before it runs tests, and every backend spec finds the built Bridge extension, scripted provider and launcher
- [x] The style checker scans the browser directory rather than the old one
- [x] No test-only package was invented to hold the harness
- [x] Both halves are green, and the browser half's wall clock is unchanged by the move

## Comments

Implemented. `packages/e2e/browser/` holds the 85 Playwright specs plus the smoke file; `packages/e2e/backend/` holds the 40 page-less tests in 11 files at equal depth, so `../src/...` and `../../server/dist/cli.js` kept their meaning. Backend specs import `vitest`, use `vi.waitFor` for the old `expect.poll`, and run under `environment: "node"` in `packages/e2e/vitest.config.ts`; `import.meta.resolve("@pi-my-ui/server")` resolves to `packages/server/dist/index.js`. The package gained `"test": "vitest run"` and a `vitest` devDependency. `verify.mjs` now builds before it tests; Playwright's `testDir`, the smoke config, the style-checker root and the tsconfig include followed the move. Final full gate: browser 85 at 30.3 s (30.8 s of the 45 s budget), backend 40 at 13.8 s. Landed in `bd776dd`.

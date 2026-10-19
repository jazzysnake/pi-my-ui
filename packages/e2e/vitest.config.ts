import { defineConfig } from "vitest/config";

// The backend half: the specs that never open a page, run under node against the built server so
// both runners exercise one code path. No `source` condition here: `@pi-my-ui/server` must resolve
// through its `import` export to dist, not to TypeScript source.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["backend/**/*.spec.ts"],
    // Real Pi children start and stop on their own schedule; this bounds a dead child at a minute.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});

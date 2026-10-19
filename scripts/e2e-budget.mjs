#!/usr/bin/env node
// The end-to-end gate: one Playwright process at the configuration's pinned worker count, timed from
// spawn to exit. A budget nobody enforces is a wish, and this suite regrows by default, so the
// stopwatch is part of the gate rather than a figure someone re-measures when they get around to it.
//
// It neither shards, retries nor reconciles: there is one run, so its own number is the total.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

// Measured on an AMD Ryzen 7 7840HS (16 CPUs, Node v26.9.0) at the configuration's pinned eight
// workers, over 153 tests: 42.6 s from spawn to exit, against 281.6 s of test bodies and a one-minute
// load of 2.9 at the start. Forty-five is the owner's affordability line rather than a multiple of
// the slowest test, so the suite holds it with little to spare until the admission walk and the
// runner split shrink the run itself. A smaller machine oversubscribes at eight workers and will not
// reproduce the figure, which is why the worker count is pinned rather than inherited.
const BUDGET_MS = 45_000;

const CONFIG = "packages/e2e/playwright.config.ts";

// Playwright's own CLI, resolved and spawned directly: npm's startup would land inside the
// stopwatch and charge the gate for its wrapper. `npm run test:e2e:raw` is the untimed equivalent.
const require = createRequire(import.meta.url);
const PLAYWRIGHT_CLI = require.resolve("@playwright/test/cli");

function fail(message) {
  console.error(`[e2e-budget] FAILED: ${message}`);
  process.exit(1);
}

function main() {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", "--config", CONFIG], {
    stdio: "inherit",
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const elapsed = (elapsedMs / 1000).toFixed(1);

  if (result.error) {
    fail(`could not start Playwright: ${result.error.message}`);
  }
  if (result.signal) {
    fail(`the suite was terminated by ${result.signal} after ${elapsed} s`);
  }
  if (result.status !== 0) {
    fail(`the suite exited ${result.status} after ${elapsed} s`);
  }
  if (elapsedMs > BUDGET_MS) {
    fail(`${elapsed} s exceeds the ${BUDGET_MS / 1000} s budget; the suite may not regrow past it`);
  }

  console.log(`[e2e-budget] ${elapsed} s of a ${BUDGET_MS / 1000} s budget`);
}

main();

import type { PlaywrightTestConfig } from "@playwright/test";

import base from "./playwright.config.js";

/**
 * The pool-footprint instrument, outside `npm run verify:full`: its numbers are properties of the machine
 * it runs on, so it is run on purpose and its output recorded. One worker, because two measurements
 * of memory running at once measure each other.
 */
const config: PlaywrightTestConfig = {
  ...base,
  testDir: "./measure",
  testIgnore: [],
  testMatch: "**/*.measure.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
};

export default config;

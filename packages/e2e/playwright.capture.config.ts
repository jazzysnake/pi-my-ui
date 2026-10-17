import type { PlaywrightTestConfig } from "@playwright/test";

import base from "./playwright.config.js";

/** The store-sequence instrument, outside `npm run verify`: it records, it does not assert. */
const config: PlaywrightTestConfig = {
  ...base,
  testDir: "./capture",
  testIgnore: [],
  testMatch: "**/*.capture.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
};

export default config;

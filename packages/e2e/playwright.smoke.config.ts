import type { PlaywrightTestConfig } from "@playwright/test";

import base from "./playwright.config.js";

/**
 * The opt-in real-provider smoke run: the same phone profile as `verify`, but only `*.smoke.ts`.
 */
const config: PlaywrightTestConfig = {
  ...base,
  testIgnore: [],
  testMatch: "**/*.smoke.ts",
};

export default config;

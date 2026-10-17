import { devices, type PlaywrightTestConfig } from "@playwright/test";

// The phone profile is Playwright's own Pixel 5 descriptor, which is a Chromium profile, so the
// one-time browser install is `npx playwright install chromium`.
const phone = devices["Pixel 5"];

const config: PlaywrightTestConfig = {
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  // A `*.smoke.ts` file needs real provider credentials, so it is opt-in on its own config and
  // must never be discovered here: `npm run verify:full` runs this configuration.
  testIgnore: ["**/*.smoke.ts"],
  reporter: [["list"]],
  outputDir: "../../test-results",
  use: { ...phone, viewport: phone.viewport },
  projects: [
    {
      name: "phone-chromium",
      use: { ...phone, viewport: phone.viewport },
    },
  ],
};

export default config;

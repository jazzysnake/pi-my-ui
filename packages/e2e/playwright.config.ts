import { devices, type PlaywrightTestConfig } from "@playwright/test";

// The phone profile is Playwright's own Pixel 5 descriptor, which is a Chromium profile, so the
// one-time browser install is `npx playwright install chromium`.
const phone = devices["Pixel 5"];

const config: PlaywrightTestConfig = {
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
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

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
  // Pinned so two runs of one suite are comparable and the budget has a fixed denominator. Eight
  // is the knee on the machine measured (AMD Ryzen 7 7840HS, 16 CPUs): 109 s at four workers,
  // 67 s at eight, 56.4 s at twelve, and that last 10.6 s is bought by filling the box, which
  // starves the host and the timing-sensitive streaming specs; a smaller box oversubscribes.
  workers: 8,
  projects: [
    {
      name: "phone-chromium",
      use: { ...phone, viewport: phone.viewport },
    },
  ],
};

export default config;

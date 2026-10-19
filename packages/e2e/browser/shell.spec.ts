import { devices, expect, test } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_START_TIMEOUT_MS = 30_000;

// The seeded Session never asks the model anything, but pi still has to be launched with a model
// it can resolve, and the scripted provider is the only model substitute the suite has.
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
  });
  const client = await startClientPageServer();
  return { home, seeded, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

// Wiring claim: the built bundle opens on a phone, connects, and renders pi's Snapshot.
test("the app opens, connects and renders a seeded transcript on a phone", async ({ page }) => {
  const harness = await startHarness();
  try {
    expect(page.viewportSize()).toEqual(devices["Pixel 5"].viewport);

    const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
    await page.goto(url);

    const status = page.getByTestId("connection-status");
    await expect(status).toHaveAttribute("data-status", "connected");

    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText("Seed text block 3.", { timeout: PI_START_TIMEOUT_MS });
    await expect(transcript).toContainText("Seed text block 54.");
    await expect(page.getByTestId("transcript-entry").first()).toBeVisible();
  } finally {
    await disposeHarness(harness);
  }
});

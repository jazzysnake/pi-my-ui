import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

// The list needs no model call, but pi still has to launch with a model it can resolve, and the
// scripted provider is the only model substitute the suite has.
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
    cwd: launch.cwd,
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

async function openBarePage(page: Page, harness: Harness): Promise<void> {
  await page.goto(`${harness.client.url}?ws=${encodeURIComponent(harness.server.url)}`);
}

test("a bare page connects, lists the project's Sessions and offers a new one", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openBarePage(page, harness);

    // The link is up even though no Session is named: the reader can pick one.
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    // With no Session open the list is already on screen.
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("session-row")).toHaveCount(1);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.seeded.id,
    );

    // Starting a Session is offered without first leaving the empty view, and it opens one.
    await page.getByTestId("new-session-action").click();
    const shell = page.getByTestId("app-shell");
    await expect(shell).toHaveAttribute("data-session-id", /^[0-9a-f]{8}-/);
    const created = await shell.getAttribute("data-session-id");
    expect(created).not.toBe(harness.seeded.id);
    await expect(page.getByTestId("transcript-empty")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

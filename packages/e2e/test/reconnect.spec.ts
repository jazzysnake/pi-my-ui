import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";
import { readUntilText } from "../src/ws-transcript";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** The transport's first reconnect delay, restated so changing the constant fails this spec. */
const FIRST_RECONNECT_DELAY_MS = 500;

const PROMPT = "produce output while away";
const REPLY = "output produced while away";

const SCRIPT: Script = [
  {
    expect: { role: "user", text: PROMPT },
    reply: { content: [{ type: "text", text: REPLY }], stopReason: "stop" },
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
  const launch = await scriptedPiLaunch(home, SCRIPT);
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

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

test("a drop rejoins after the first backoff and catches up on output produced meanwhile", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    // The clock is installed before the page loads so the reconnect timer is the fake one; time
    // flows until it is paused, so the initial connect is unaffected.
    await page.clock.install();
    await openHarness(page, harness);

    const status = page.getByTestId("connection-status");
    // Read the page's own (faked) now, so pausing cannot ask the clock to move backwards.
    const pageNow = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(pageNow + 100);
    harness.server.dropViewerConnections();
    await expect(status).toHaveAttribute("data-status", "reconnecting");

    // Output produced by another viewer while this page is down, so the page can only show it by
    // catching up after it rejoins.
    const writer = await connectWsSession(harness.server.url);
    try {
      writer.send({ type: "subscribe", sessionId: harness.seeded.id });
      await writer.next();
      writer.send({ type: "prompt", sessionId: harness.seeded.id, text: PROMPT });
      await readUntilText(writer, REPLY);
    } finally {
      await writer.close();
    }

    // The reconnect is due at the first backoff delay: not before, and not after.
    await page.clock.runFor(FIRST_RECONNECT_DELAY_MS - 1);
    await expect(status).toHaveAttribute("data-status", "reconnecting");
    await page.clock.runFor(1);

    await expect(status).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText(REPLY);
  } finally {
    await disposeHarness(harness);
  }
});

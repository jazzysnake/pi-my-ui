import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { piChildPids } from "../src/pi-processes";

const PI_TEST_TIMEOUT_MS = 120_000;
const PI_START_TIMEOUT_MS = 30_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

const NAMED_MARKER = "Seed text block 54.";

interface Harness {
  readonly home: HermeticHome;
  readonly named: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const named = await seedSession(home, "plain");
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
  return { home, named, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.named.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(NAMED_MARKER, {
    timeout: PI_START_TIMEOUT_MS,
  });
}

test("a crashed Pi child shows its exit details and Reconnect restores the Session", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);
    await expect.poll(() => piChildPids().length).toBe(1);
    const child = piChildPids()[0];
    if (child === undefined) {
      throw new Error("opening the Session started no Pi child");
    }

    // A real crash of the real child: the server learns about it from the process it started.
    process.kill(child, "SIGKILL");

    const row = page.getByTestId("run-state");
    await expect(row).toHaveAttribute("data-run-state", "crashed");
    await expect(page.getByTestId("run-state-label")).toHaveText("Pi child exited");
    await expect(page.getByTestId("run-state-detail")).toHaveText("signal SIGKILL");

    await page.getByTestId("session-reconnect").click();
    await expect(row).toHaveAttribute("data-run-state", "starting");

    // The respawn restores the transcript from the intact Session file and clears the crash.
    await expect(row).toHaveCount(0, { timeout: PI_START_TIMEOUT_MS });
    await expect(page.getByTestId("transcript")).toContainText(NAMED_MARKER);
    await expect.poll(() => piChildPids().length).toBe(1);
    expect(piChildPids()).not.toContain(child);
  } finally {
    await disposeHarness(harness);
  }
});

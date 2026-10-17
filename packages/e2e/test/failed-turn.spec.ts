import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, writeAttemptsSession } from "../src/fixture-builder";
import {
  createHermeticHome,
  scriptedPiLaunch,
  type HermeticHome,
  type ScriptedPiLaunch,
} from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

// The message card's own copy control needs the browser clipboard, as the markdown spec does.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** The danger token every failure states itself in, resolved to the colour the browser paints. */
const DANGER_RGB = "rgb(255, 123, 114)";

interface Harness {
  readonly home: HermeticHome;
  readonly launch: ScriptedPiLaunch;
  readonly client: ClientPageServer;
  readonly port: number;
  server: RunningServer;
}

function serverConfig(
  home: HermeticHome,
  launch: ScriptedPiLaunch,
  port: number,
): Parameters<typeof startServer>[0] {
  return {
    cwd: launch.cwd,
    sessionDir: home.sessionsDir,
    port,
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
  };
}

async function startHarness(home: HermeticHome, script: Script): Promise<Harness> {
  const launch = await scriptedPiLaunch(home, script);
  const port = home.ports.allocate();
  const client = await startClientPageServer();
  return {
    home,
    launch,
    client,
    port,
    server: await startServer(serverConfig(home, launch, port)),
  };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

/**
 * Replace the server with a second one on the same port and session directory. It has no memory of
 * the run the first one served, so the Snapshot it answers with can only have been built from the
 * Session file: the seed path, reached the way a browser rejoining a restarted server reaches it.
 */
async function restartServer(harness: Harness): Promise<void> {
  await harness.server.close();
  harness.server = await startServer(serverConfig(harness.home, harness.launch, harness.port));
}

function sessionUrl(harness: Harness, sessionId: string): string {
  return `${harness.client.url}?session=${encodeURIComponent(sessionId)}&ws=${encodeURIComponent(harness.server.url)}`;
}

async function openSession(page: Page, harness: Harness, sessionId: string): Promise<void> {
  await page.goto(sessionUrl(harness, sessionId));
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

/** The one message card that carries an error block. */
function failedCard(page: Page) {
  return page.getByTestId("message-card").filter({ has: page.getByTestId("error-block") });
}

test("a failed turn states pi's error in the transcript, live and again from the Session file", async ({
  page,
}) => {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const harness = await startHarness(home, [
    {
      expect: { role: "user", text: "break the run" },
      reply: { content: [], stopReason: "error", errorMessage: "the model exploded" },
    },
  ]);
  try {
    await openSession(page, harness, seeded.id);
    await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");

    await page.getByTestId("composer-input").fill("break the run");
    await page.getByTestId("composer-send").click();

    // The live run-state row keeps reporting the failure: the card is the durable record beside it.
    await expect(page.getByTestId("run-state")).toHaveAttribute("data-run-state", "errored");
    await expect(page.getByTestId("run-state-detail")).toHaveText("the model exploded");

    const live = failedCard(page);
    await expect(live).toHaveCount(1);
    await expect(live.getByTestId("error-label")).toHaveText("error");
    await expect(live.getByTestId("error-text")).toHaveText("the model exploded");
    expect(
      await live.getByTestId("error-text").evaluate((element) => getComputedStyle(element).color),
    ).toBe(DANGER_RGB);
    // A failure with no content left nothing to copy, so its card offers no control.
    await expect(live.getByTestId("copy-message")).toHaveCount(0);

    await restartServer(harness);
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    const reseeded = failedCard(page);
    await expect(reseeded).toHaveCount(1);
    await expect(reseeded.getByTestId("error-label")).toHaveText("error");
    await expect(reseeded.getByTestId("error-text")).toHaveText("the model exploded");
    expect(
      await reseeded
        .getByTestId("error-text")
        .evaluate((element) => getComputedStyle(element).color),
    ).toBe(DANGER_RGB);
    await expect(reseeded.getByTestId("copy-message")).toHaveCount(0);
    // Nothing is running after the re-seed, so the card is the only record of the failure left.
    await expect(page.getByTestId("run-state")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

test("a seeded attempt keeps its error after the content, and an attempt with no content leaves no row", async ({
  page,
}) => {
  const home = await createHermeticHome();
  const seeded = await writeAttemptsSession(home, [
    {
      prompt: "read the file",
      stopReason: "error",
      text: "I will read it now.",
      errorMessage: "the connection dropped",
    },
    { prompt: "try the summary", stopReason: "error" },
    { prompt: "cancel this one", stopReason: "aborted" },
  ]);
  const harness = await startHarness(home, [
    {
      expect: { role: "user", text: "a prompt this recording never saw" },
      reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
    },
  ]);
  try {
    await openSession(page, harness, seeded.id);
    await expect(page.getByTestId("transcript")).toContainText("read the file");

    // Three prompts answered by three attempts, and the cancelled one left no row of its own.
    await expect(page.getByTestId("transcript-entry")).toHaveCount(5);

    const failed = failedCard(page);
    await expect(failed).toHaveCount(2);

    const partial = failed.filter({ hasText: "the connection dropped" });
    await expect(partial.getByTestId("error-label")).toHaveText("error");
    await expect(partial.getByTestId("error-text")).toHaveText("the connection dropped");
    // The content the attempt produced comes first, and the failure is stated after it.
    const text = (await partial.textContent()) ?? "";
    expect(text.indexOf("I will read it now.")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("I will read it now.")).toBeLessThan(
      text.indexOf("the connection dropped"),
    );

    // A failed attempt with content keeps its control, and that control carries only the content.
    const copy = partial.getByTestId("copy-message");
    await expect(copy).toHaveCount(1);
    await copy.click();
    await expect(copy).toHaveAttribute("data-copied", "true");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("I will read it now.");

    // pi gave no error text, so the block states the fallback the run state uses.
    const bare = failed.filter({ hasText: "the run failed" });
    await expect(bare.getByTestId("error-text")).toHaveText("the run failed");
    await expect(bare.getByTestId("copy-message")).toHaveCount(0);

    // The same file read again produces the same rows: the record does not depend on the run.
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript-entry")).toHaveCount(5);
    await expect(failedCard(page)).toHaveCount(2);
    await expect(page.getByTestId("error-text")).toHaveCount(2);
    await expect(page.getByTestId("run-state")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

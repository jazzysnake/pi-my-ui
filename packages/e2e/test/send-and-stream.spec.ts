import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { expectComposerSend } from "../src/composer-send";
import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script, seed: SeedName = "plain"): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, seed);
  const launch = await scriptedPiLaunch(home, script);
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
  // A long seed's early turns are outside the mounted window, so the first mounted row is the load
  // signal; one Snapshot renders the whole window at once.
  await expect(page.getByTestId("transcript-entry").first()).toBeVisible();
}

/** Distance from the transcript's bottom edge in CSS px; 0 means pinned to the newest content. */
async function distanceFromBottom(page: Page): Promise<number> {
  return await page.getByTestId("transcript").evaluate((element) => {
    const container = element as HTMLElement;
    return container.scrollHeight - container.scrollTop - container.clientHeight;
  });
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("sends a message and renders the streamed scripted reply and its thinking", async ({
  page,
}) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "what is the plan?" },
      reply: {
        content: [
          { type: "thinking", thinking: "Weighing the two seams." },
          { type: "text", text: "Wrap the seam, do not replace it." },
        ],
        stopReason: "stop",
      },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "what is the plan?");

    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText("what is the plan?");
    await expect(transcript).toContainText("Wrap the seam, do not replace it.");
    const reasoning = page
      .getByTestId("reasoning-block")
      .filter({ hasText: "Weighing the two seams." });
    await expect(reasoning).toContainText("Weighing the two seams.");
    // Reasoning stays collapsed while it streams.
    await expect(reasoning).not.toHaveAttribute("open", "");
    // The run settled server-side: the control is a Send button again, not a Stop button.
    await expectComposerSend(page, "Send");
  } finally {
    await disposeHarness(harness);
  }
});

test("keeps the view pinned to the newest output while streaming", async ({ page }) => {
  const harness = await startHarness(
    [
      {
        expect: { role: "user", text: "add one more line" },
        reply: { content: [{ type: "text", text: "Here is one more line." }], stopReason: "stop" },
      },
    ],
    "large",
  );
  try {
    await openHarness(page, harness);
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(4);

    await sendMessage(page, "add one more line");
    await expect(page.getByTestId("transcript")).toContainText("Here is one more line.");
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(4);
  } finally {
    await disposeHarness(harness);
  }
});

test("turns send into stop while a run is active and stop aborts it", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "run the slow command" },
      reply: {
        content: [
          { type: "text", text: "starting the slow command" },
          {
            type: "toolCall",
            id: "call_slow_1",
            name: "bash",
            arguments: { command: "sleep 30", timeout: 60 },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "finished" }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    const control = page.getByTestId("composer-send");

    await sendMessage(page, "run the slow command");
    await expectComposerSend(page, "Stop");
    await expect(page.getByTestId("transcript")).toContainText("starting the slow command");

    await control.click();
    await expect(page.getByTestId("run-state")).toHaveAttribute("data-run-state", "aborted");
    await expect(page.getByTestId("run-state-label")).toHaveText("Aborted");
    await expectComposerSend(page, "Send");
  } finally {
    await disposeHarness(harness);
  }
});

test("renders an errored run with the failure text", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "break the run" },
      reply: { content: [], stopReason: "error", errorMessage: "the model exploded" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "break the run");

    await expect(page.getByTestId("run-state")).toHaveAttribute("data-run-state", "errored");
    await expect(page.getByTestId("run-state-label")).toHaveText("Error");
    await expect(page.getByTestId("run-state-detail")).toHaveText("the model exploded");
    await expectComposerSend(page, "Send");
  } finally {
    await disposeHarness(harness);
  }
});

test("renders the retry attempt count and recovers", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "try again please" },
      reply: { content: [], stopReason: "error", errorMessage: "529 overloaded" },
    },
    {
      expect: { role: "user", text: "try again please" },
      reply: { content: [{ type: "text", text: "recovered on the retry" }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "try again please");

    await expect(page.getByTestId("run-state")).toHaveAttribute("data-run-state", "retrying");
    await expect(page.getByTestId("run-state-label")).toHaveText("Retrying");
    await expect(page.getByTestId("run-state-detail")).toHaveText(
      "Attempt 1 of 3 · 529 overloaded",
    );

    await expect(page.getByTestId("transcript")).toContainText("recovered on the retry");
    // The recovered run leaves no status row behind.
    await expect(page.getByTestId("run-state")).toHaveCount(0);
    await expectComposerSend(page, "Send");
  } finally {
    await disposeHarness(harness);
  }
});

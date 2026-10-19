import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, script);
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

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("renders the seed's completed and failed tool results as cards", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "unused by this test" },
      reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);

    // The Snapshot folds durable tool results into the matching calls, so a reload shows the same
    // statuses a live run streamed.
    await expect(page.locator('[data-tool-status="success"]').first()).toBeVisible();
    await expect(page.locator('[data-tool-status="error"]').first()).toBeVisible();
    // A result whose call is not on the path keeps its own row rather than vanishing.
    await expect(page.getByTestId("transcript")).toContainText("Seed text block 12.");
  } finally {
    await disposeHarness(harness);
  }
});

test("streams a scripted tool call from running to a success card", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "run a quick command" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_quick_1",
            name: "bash",
            arguments: { command: "sleep 2 && echo tool-output-marker", timeout: 10 },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "The command finished." }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "run a quick command");

    // The tool is still executing, so its card is the only one in the running state.
    const running = page.locator('[data-tool-status="running"]');
    await expect(running).toHaveCount(1);
    await expect(running.getByTestId("tool-card-name")).toHaveText("bash");

    const completed = page.getByTestId("tool-card").filter({ hasText: "tool-output-marker" });
    await expect(completed).toHaveAttribute("data-tool-status", "success");
    await expect(completed.getByTestId("tool-card-output")).toContainText("tool-output-marker");
    await expect(page.getByTestId("transcript")).toContainText("The command finished.");
  } finally {
    await disposeHarness(harness);
  }
});

test("folds a long tool output and opens it in place", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "count to fifty" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_long_1",
            name: "bash",
            arguments: { command: "seq 1 50", timeout: 10 },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "Counted to fifty." }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "count to fifty");

    const card = page.getByTestId("tool-card").filter({ hasText: "seq 1 50" });
    await expect(card).toHaveAttribute("data-tool-status", "success");

    // Six of the fifty lines are on screen; the rest is stated, not printed.
    const output = card.getByTestId("tool-card-output");
    await expect(output.getByRole("paragraph")).toHaveCount(6);
    const fold = card.getByTestId("tool-card-output-fold");
    await expect(fold).toHaveText("⤷ 44 more lines");

    await fold.click();

    await expect(output).toContainText("50");
    // The opened body is one text node, not fifty paragraphs.
    await expect(output.getByRole("paragraph")).toHaveCount(0);
    await expect(fold).toHaveText("⤷ collapse");
  } finally {
    await disposeHarness(harness);
  }
});

test("renders a failing scripted tool as an error card", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "run a failing command" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_fail_1",
            name: "bash",
            arguments: { command: "echo tool-error-marker && exit 3", timeout: 10 },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "It failed." }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "run a failing command");

    const failed = page.getByTestId("tool-card").last();
    await expect(failed).toHaveAttribute("data-tool-status", "error");
    await expect(failed.getByTestId("tool-card-status")).toHaveText("Failed");
  } finally {
    await disposeHarness(harness);
  }
});

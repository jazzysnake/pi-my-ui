import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import type { Gate } from "../src/gate";
import { startHarness, type Harness } from "../src/test-harness";

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.session.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("renders the seed's completed and failed tool results as cards", async ({ page }) => {
  const harness = await startHarness({
    script: () => [
      {
        expect: { role: "user", text: "unused by this test" },
        reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
      },
    ],
  });
  try {
    await openHarness(page, harness);

    // The Snapshot folds durable tool results into the matching calls, so a reload shows the same
    // statuses a live run streamed.
    await expect(page.locator('[data-tool-status="success"]').first()).toBeVisible();
    await expect(page.locator('[data-tool-status="error"]').first()).toBeVisible();
    // A result whose call is not on the path keeps its own row rather than vanishing.
    await expect(page.getByTestId("transcript")).toContainText("Seed text block 12.");
  } finally {
    await harness.dispose();
  }
});

/**
 * One tool call that waits on this test's gate, so the card's running state is observed while the
 * command is genuinely still executing and the success card is produced by this test's release.
 */
function quickCommandScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: "run a quick command" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_quick_1",
            name: "bash",
            arguments: { ...gate("quick").command("echo tool-output-marker") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "The command finished." }], stopReason: "stop" },
    },
  ];
}

test("streams a scripted tool call from running to a success card", async ({ page }) => {
  const harness = await startHarness({ script: quickCommandScript });
  const quick = harness.gate("quick");
  try {
    await openHarness(page, harness);
    await sendMessage(page, "run a quick command");

    await quick.releaseAfter(async () => {
      // The tool is still executing, so its card is the only one in the running state.
      const running = page.locator('[data-tool-status="running"]');
      await expect(running).toHaveCount(1);
      await expect(running.getByTestId("tool-card-name")).toHaveText("bash");
    });

    const completed = page.getByTestId("tool-card").filter({ hasText: "tool-output-marker" });
    await expect(completed).toHaveAttribute("data-tool-status", "success");
    await expect(completed.getByTestId("tool-card-output")).toContainText("tool-output-marker");
    await expect(page.getByTestId("transcript")).toContainText("The command finished.");
  } finally {
    await harness.dispose();
  }
});

test("folds a long tool output and opens it in place", async ({ page }) => {
  const harness = await startHarness({
    script: () => [
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
    ],
  });
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
    await harness.dispose();
  }
});

test("renders a failing scripted tool as an error card", async ({ page }) => {
  const harness = await startHarness({
    script: () => [
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
    ],
  });
  try {
    await openHarness(page, harness);
    await sendMessage(page, "run a failing command");

    const failed = page.getByTestId("tool-card").last();
    await expect(failed).toHaveAttribute("data-tool-status", "error");
    await expect(failed.getByTestId("tool-card-status")).toHaveText("Failed");
  } finally {
    await harness.dispose();
  }
});

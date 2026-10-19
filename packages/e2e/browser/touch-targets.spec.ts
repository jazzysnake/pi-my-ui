import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import { expectComposerSend } from "../src/composer-send";
import type { Gate } from "../src/gate";
import { startHarness, type Harness } from "../src/test-harness";
import { expectEveryControlMeetsTouchTarget } from "../src/touch-targets";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=";

/**
 * A run that stays open until the test opens its gate, so the states only a live run has — the
 * While-running row, a running tool card, a running bash card — can be measured for as long as the
 * sweep needs them. Its second step answers the tool's result, so pi is never left waiting for a
 * reply the recording does not hold.
 */
function runningScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: "hold the run open" },
      reply: {
        content: [
          { type: "thinking", thinking: "Deciding how long to wait." },
          { type: "text", text: "Holding the run open.\n\n```bash\ngit status\n```" },
          {
            type: "toolCall",
            id: "call_hold",
            name: "bash",
            arguments: { ...gate("hold").command("echo released") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "the wait is over" }], stopReason: "stop" },
    },
  ];
}

async function openHarness(page: Page, harness: Harness, marker: string): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.session.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(marker);
}

// Wiring claim: every control the composer's states put on screen is at least a 44 px target.
test("every control the composer's own states put on screen meets the minimum", async ({
  page,
}) => {
  const harness = await startHarness({ script: runningScript });
  const hold = harness.gate("hold");
  try {
    await openHarness(page, harness, "Seed text block 3.");
    await expect(page.getByTestId("status-model")).toBeVisible();
    await expect(page.getByTestId("copy-message").first()).toHaveAttribute(
      "aria-label",
      "Copy message",
    );
    await expectEveryControlMeetsTouchTarget(page, "a Session open");

    await page.getByTestId("composer-attach-input").setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
    });
    await expect(page.getByTestId("attachment")).toHaveCount(1);
    await expectEveryControlMeetsTouchTarget(page, "an attachment pending");

    await page.getByTestId("composer-input").fill("hold the run open");
    await page.getByTestId("composer-send").click();
    await expect(page.getByTestId("streaming-choice-hint")).toBeVisible();
    await expect(page.getByTestId("tool-card").last()).toHaveAttribute(
      "data-tool-status",
      "running",
    );
    // The fenced code the reply carries puts the block's own copy control in this sweep.
    await expect(page.getByTestId("copy-code").first()).toHaveAttribute("aria-label", "Copy code");
    await expectEveryControlMeetsTouchTarget(page, "a run active");

    // A collapsed reasoning block is a `<summary>`, and it is only on screen while its entry is.
    await expect(page.getByTestId("reasoning-block").last()).toBeVisible();
    await page.getByTestId("reasoning-block").last().locator("summary").click();
    await expectEveryControlMeetsTouchTarget(page, "a reasoning block expanded");

    // The gate held the run for every sweep above, so the tap below really is the stop control and
    // not a Send that happens to look the same once the run settled.
    await hold.releaseAfter(async () => {
      await expectComposerSend(page, "Stop");
      await page.getByTestId("composer-send").click();
      await expectComposerSend(page, "Send");
    });

    await page.getByTestId("model-picker-toggle").click();
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the model picker open");
    await page.getByTestId("model-picker-toggle").click();

    await page.getByTestId("thinking-picker-toggle").click();
    await expect(page.getByTestId("thinking-option").first()).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the thinking picker open");
    await page.getByTestId("thinking-picker-toggle").click();

    await page.getByTestId("composer-input").fill("/");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the command palette open");
    await page.getByTestId("composer-input").fill("");

    await page.getByTestId("sessions-toggle").click();
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the Session drawer open");
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();

    await page.getByTestId("files-toggle").click();
    await expect(page.getByTestId("file-tree")).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the file tree open");
    await page.getByTestId("file-tree-close").click();

    await page.getByTestId("composer-branch").click();
    await expect(page.getByTestId("message-tree-modal")).toBeVisible();
    await expect(page.getByTestId("message-tree-select").first()).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the message tree open");
    await page.getByTestId("message-tree-close").click();

    await page.getByTestId("composer-input").fill("/fork");
    await page.getByTestId("composer-send").click();
    await expect(page.getByTestId("fork-picker")).toBeVisible();
    await expect(page.getByTestId("fork-picker-row").first()).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the fork picker open");
    await page.getByTestId("fork-picker-close").click();
  } finally {
    await harness.dispose();
  }
});

// Wiring claim: the Starting row's controls are full touch targets before any Snapshot arrives.
test("a Session that is still starting meets the minimum", async ({ page }) => {
  const harness = await startHarness({
    script: () => [
      {
        expect: { role: "user", text: "a prompt this recording never saw" },
        reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
      },
    ],
  });
  try {
    // The row exists from the first frame, before any Snapshot: recovery and a cold start are waits,
    // and every control they put on screen must still be tappable.
    const url = `${harness.client.url}?session=${encodeURIComponent(harness.session.id)}&ws=${encodeURIComponent(harness.server.url)}`;
    await page.goto(url);
    await expect(page.getByTestId("run-state")).toHaveAttribute("data-run-state", "starting");
    await expectEveryControlMeetsTouchTarget(page, "a Session starting");
    await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.", {
      timeout: 30_000,
    });
  } finally {
    await harness.dispose();
  }
});

// Wiring claim: the agent list, notification controls and a focused subagent's composer are full touch targets.
test("the agent list and the transcript's own controls meet the minimum", async ({ page }) => {
  const harness = await startHarness({
    seeds: ["subagents"],
    script: () => [
      {
        expect: { role: "user", text: "a prompt this recording never saw" },
        reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
      },
    ],
  });
  try {
    await openHarness(page, harness, "Seed text block 9.");
    await expect(page.getByTestId("notification-card").first()).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "a notification in the transcript");

    await page.getByTestId("notification-card").first().locator("summary").click();
    await expectEveryControlMeetsTouchTarget(page, "a notification expanded");

    await page.getByTestId("agent-pill").click();
    await expect(page.getByTestId("agent-list")).toBeVisible();
    await expect(page.getByTestId("agent-row").first()).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "the agent list open");

    // Focusing a settled subagent explains that steering is unavailable, in the composer that would
    // otherwise send into the void.
    await page.locator('[data-testid="agent-row"][data-row-kind="agent"]').first().click();
    await expect(page.getByTestId("agent-list")).toHaveCount(0);
    await expect(page.getByTestId("steer-refusal")).toBeVisible();
    await expectEveryControlMeetsTouchTarget(page, "a focused subagent's composer");
  } finally {
    await harness.dispose();
  }
});

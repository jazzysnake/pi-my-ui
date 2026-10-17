import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { expectEveryControlMeetsTouchTarget } from "../src/touch-targets";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=";

/**
 * A run that stays open long enough to measure the states only a live run has: the While-running
 * row, a running tool card and a running bash card. Its second step answers the tool's result, so pi
 * is never left waiting for a reply the recording does not hold.
 */
const RUNNING_SCRIPT: Script = [
  {
    expect: { role: "user", text: "hold the run open" },
    reply: {
      content: [
        { type: "thinking", thinking: "Deciding how long to wait." },
        { type: "text", text: "Holding the run open." },
        { type: "toolCall", id: "call_hold", name: "bash", arguments: { command: "sleep 5" } },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "bash" },
    reply: { content: [{ type: "text", text: "the wait is over" }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script, seed: SeedName): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, seed);
  const launch = await scriptedPiLaunch(home, script);
  const server = await startServer({
    cwd: launch.cwd,
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args: launch.args, env: launch.env, provider: launch.provider, model: launch.model },
  });
  const client = await startClientPageServer();
  return { home, seeded, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

async function openHarness(page: Page, harness: Harness, marker: string): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(marker);
}

test("every control the composer's own states put on screen meets the minimum", async ({
  page,
}) => {
  const harness = await startHarness(RUNNING_SCRIPT, "plain");
  try {
    await openHarness(page, harness, "Seed text block 3.");
    await expect(page.getByTestId("status-model")).toBeVisible();
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
    await expectEveryControlMeetsTouchTarget(page, "a run active");

    // A collapsed reasoning block is a `<summary>`, and it is only on screen while its entry is.
    await expect(page.getByTestId("reasoning-block").last()).toBeVisible();
    await page.getByTestId("reasoning-block").last().locator("summary").click();
    await expectEveryControlMeetsTouchTarget(page, "a reasoning block expanded");

    await page.getByTestId("composer-send").click();
    await expect(page.getByTestId("composer-send")).toHaveText("Send");

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
  } finally {
    await disposeHarness(harness);
  }
});

test("the agent list and the transcript's own controls meet the minimum", async ({ page }) => {
  const harness = await startHarness(
    [
      {
        expect: { role: "user", text: "a prompt this recording never saw" },
        reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
      },
    ],
    "subagents",
  );
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
  } finally {
    await disposeHarness(harness);
  }
});

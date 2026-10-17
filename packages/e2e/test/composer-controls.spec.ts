import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

// A 2×2 red PNG: small enough for a thumbnail, and a valid image pi's resizer can decode.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=";

/** A scripted run needs at least one step even when the test never prompts the model. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

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
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

/** Send a plain message through the composer input and its primary control. */
async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("an attached image reaches pi with the message", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "look at this", images: 1 },
      reply: { content: [{ type: "text", text: "I can see the image." }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await page.getByTestId("composer-attach-input").setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
    });
    await expect(page.getByTestId("attachment")).toHaveCount(1);

    await sendMessage(page, "look at this");
    await expect(page.getByTestId("transcript")).toContainText("I can see the image.");
    // The accepted message cleared the composer, thumbnails included.
    await expect(page.getByTestId("attachment")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

test("steer enters the run at its next step", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "start the long job" },
      reply: {
        content: [
          { type: "text", text: "starting the job" },
          {
            type: "toolCall",
            id: "call_steer_1",
            name: "bash",
            arguments: { command: "sleep 4", timeout: 60 },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "user", text: "steer it now" },
      reply: { content: [{ type: "text", text: "redirected mid-run" }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "start the long job");
    await expect(page.getByTestId("composer-send")).toHaveText("Stop");

    // Steer is the row's default, so the row's Send is the only gesture needed.
    await page.getByTestId("composer-input").fill("steer it now");
    await page.getByTestId("composer-send-while-running").click();

    await expect(page.getByTestId("transcript")).toContainText("redirected mid-run");
    await expect(page.getByTestId("transcript")).toContainText("steer it now");
  } finally {
    await disposeHarness(harness);
  }
});

test("follow up waits until the run finishes", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "start the long job" },
      reply: {
        content: [
          { type: "text", text: "starting the job" },
          {
            type: "toolCall",
            id: "call_follow_1",
            name: "bash",
            arguments: { command: "sleep 4", timeout: 60 },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "the job finished" }], stopReason: "stop" },
    },
    {
      expect: { role: "user", text: "then say bye" },
      reply: { content: [{ type: "text", text: "bye for now" }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "start the long job");
    await expect(page.getByTestId("composer-send")).toHaveText("Stop");

    await page.getByTestId("composer-input").fill("then say bye");
    await page.getByTestId("streaming-choice-follow-up").click();
    await page.getByTestId("composer-send-while-running").click();

    await expect(page.getByTestId("transcript")).toContainText("the job finished");
    await expect(page.getByTestId("transcript")).toContainText("bye for now");
  } finally {
    await disposeHarness(harness);
  }
});

test("the status strip round-trips pi's automatic compaction", async ({ page }) => {
  const harness = await startHarness(UNUSED_SCRIPT);
  try {
    await openHarness(page, harness);
    const toggle = page.getByTestId("auto-compaction-toggle");
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("status-model")).toHaveText("Scripted model");

    const before = await toggle.getAttribute("data-auto-compaction");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("data-auto-compaction", before ?? "");
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-auto-compaction", before ?? "");
  } finally {
    await disposeHarness(harness);
  }
});

test("the status strip lists pi's models and thinking levels", async ({ page }) => {
  const harness = await startHarness(UNUSED_SCRIPT);
  try {
    await openHarness(page, harness);
    await page.getByTestId("model-picker-toggle").click();
    await expect(page.getByTestId("model-option").first()).toContainText("Scripted model");

    await page.getByTestId("thinking-picker-toggle").click();
    await expect(page.getByTestId("thinking-option")).toHaveCount(5);

    // Selecting a level round-trips through pi and back to the strip.
    await page.getByTestId("thinking-option").filter({ hasText: "High" }).click();
    await expect(page.getByTestId("status-thinking")).toHaveText("High");
  } finally {
    await disposeHarness(harness);
  }
});

test("Enter inserts a newline and Ctrl+Enter sends", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "sent from the keyboard" },
      reply: { content: [{ type: "text", text: "keyboard reply" }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    const input = page.getByTestId("composer-input");
    await input.click();
    await input.press("Enter");
    // Plain Enter is the textarea's own newline, never a send.
    await expect(input).toHaveValue("\n");

    await input.fill("sent from the keyboard");
    await input.press("Control+Enter");
    await expect(page.getByTestId("transcript")).toContainText("keyboard reply");
  } finally {
    await disposeHarness(harness);
  }
});

test("Escape cancels the running turn", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "start the long job" },
      reply: {
        content: [
          { type: "text", text: "starting the job" },
          {
            type: "toolCall",
            id: "call_escape_1",
            name: "bash",
            arguments: { command: "sleep 30", timeout: 60 },
          },
        ],
        stopReason: "toolUse",
      },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "start the long job");
    await expect(page.getByTestId("composer-send")).toHaveText("Stop");

    const input = page.getByTestId("composer-input");
    await input.click();
    await input.press("Escape");

    await expect(page.getByTestId("run-state")).toHaveAttribute("data-run-state", "aborted");
    await expect(page.getByTestId("composer-send")).toHaveText("Send");
  } finally {
    await disposeHarness(harness);
  }
});

test("send is the row's last control in the thumb corner at a full touch size", async ({
  page,
}) => {
  const harness = await startHarness(UNUSED_SCRIPT);
  try {
    await openHarness(page, harness);
    const labels = await page
      .getByTestId("composer")
      .locator("textarea ~ button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-testid")));
    expect(labels).toEqual(["composer-attach", "composer-branch", "composer-send"]);

    const send = page.getByTestId("composer-send");
    const box = await send.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    const composer = await page.getByTestId("composer").evaluate((element) => ({
      right: element.getBoundingClientRect().right,
      paddingRight: parseFloat(getComputedStyle(element).paddingRight),
    }));
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(composer.right + 1);
  } finally {
    await disposeHarness(harness);
  }
});

test("the composer holds up with a keyboard-sized viewport and after rotation", async ({
  page,
}) => {
  const harness = await startHarness([
    {
      expect: { role: "user", text: "rotated message" },
      reply: { content: [{ type: "text", text: "received after rotation" }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);

    // A phone with the on-screen keyboard open: little height, the portrait width.
    await page.setViewportSize({ width: 393, height: 320 });
    const composer = page.getByTestId("composer");
    await expect(composer).toBeVisible();
    const send = page.getByTestId("composer-send");
    await expect(send).toBeVisible();
    const keyboardBox = await send.boundingBox();
    expect(keyboardBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(keyboardBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((keyboardBox?.y ?? 0) + (keyboardBox?.height ?? 0)).toBeLessThanOrEqual(320);

    // Rotation: the width and height swap.
    await page.setViewportSize({ width: 820, height: 393 });
    await expect(composer).toBeVisible();
    await sendMessage(page, "rotated message");
    await expect(page.getByTestId("transcript")).toContainText("received after rotation");
  } finally {
    await disposeHarness(harness);
  }
});

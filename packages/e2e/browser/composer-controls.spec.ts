import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import { expectComposerSend } from "../src/composer-send";
import type { Gate } from "../src/gate";
import { startHarness, type Harness } from "../src/test-harness";

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

/**
 * A run whose only tool call waits on this test's gate, so the composer's mid-run controls are
 * exercised against a run that cannot settle on its own schedule.
 */
function heldRunScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: "start the long job" },
      reply: {
        content: [
          { type: "text", text: "starting the job" },
          {
            type: "toolCall",
            id: "call_hold_1",
            name: "bash",
            arguments: { ...gate("hold").command("echo released") },
          },
        ],
        stopReason: "toolUse",
      },
    },
  ];
}

function steerScript(gate: (name: string) => Gate): Script {
  return [
    ...heldRunScript(gate),
    {
      expect: { role: "user", text: "steer it now" },
      reply: { content: [{ type: "text", text: "redirected mid-run" }], stopReason: "stop" },
    },
  ];
}

function followUpScript(gate: (name: string) => Gate): Script {
  return [
    ...heldRunScript(gate),
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "the job finished" }], stopReason: "stop" },
    },
    {
      expect: { role: "user", text: "then say bye" },
      reply: { content: [{ type: "text", text: "bye for now" }], stopReason: "stop" },
    },
  ];
}

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.session.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

/** Send a plain message through the composer input and its primary control. */
async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

// Wiring claim: an attached image reaches pi with the message and the accepted send clears it.
test("an attached image reaches pi with the message", async ({ page }) => {
  const harness = await startHarness({
    script: () => [
      {
        expect: { role: "user", text: "look at this", images: 1 },
        reply: { content: [{ type: "text", text: "I can see the image." }], stopReason: "stop" },
      },
    ],
  });
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
    await harness.dispose();
  }
});

// Wiring claim: pi delivers a steer at the next turn boundary, and the draft stays until then.
test("steer enters the run at its next step", async ({ page }) => {
  const harness = await startHarness({ script: steerScript });
  const hold = harness.gate("hold");
  try {
    await openHarness(page, harness);
    await sendMessage(page, "start the long job");
    await expectComposerSend(page, "Stop");

    // Steer is the row's default, so the row's Send is the only gesture needed.
    await page.getByTestId("composer-input").fill("steer it now");
    await page.getByTestId("composer-send-while-running").click();

    // The steer is handed to pi but not delivered: the running turn still owns the run, and the
    // draft stays until pi echoes the message into the transcript, which happens only when the steer
    // enters the run. The gate is what keeps that from happening before the release.
    await hold.releaseAfter(async () => {
      await expectComposerSend(page, "Stop");
      await expect(page.getByTestId("composer-send-while-running")).toBeDisabled();
      await expect(page.getByTestId("transcript")).not.toContainText("steer it now");
    });

    await expect(page.getByTestId("transcript")).toContainText("steer it now");
    await expect(page.getByTestId("transcript")).toContainText("redirected mid-run");
  } finally {
    await harness.dispose();
  }
});

// Wiring claim: a follow-up reaches pi only after the run in front of it settles.
test("follow up waits until the run finishes", async ({ page }) => {
  const harness = await startHarness({ script: followUpScript });
  const hold = harness.gate("hold");
  try {
    await openHarness(page, harness);
    await sendMessage(page, "start the long job");
    await expectComposerSend(page, "Stop");

    await page.getByTestId("composer-input").fill("then say bye");
    await page.getByTestId("streaming-choice-follow-up").click();
    await page.getByTestId("composer-send-while-running").click();

    // The follow-up is queued behind a run the gate still holds: the row is disabled and the job has
    // not reported finishing, so the replies below can only arrive after the release.
    await hold.releaseAfter(async () => {
      await expectComposerSend(page, "Stop");
      await expect(page.getByTestId("composer-send-while-running")).toBeDisabled();
      await expect(page.getByTestId("transcript")).not.toContainText("the job finished");
    });

    await expect(page.getByTestId("transcript")).toContainText("the job finished");
    await expect(page.getByTestId("transcript")).toContainText("bye for now");
  } finally {
    await harness.dispose();
  }
});

// Wiring claim: the auto-compaction toggle round-trips through pi and shows only what pi reports.
test("the status strip round-trips pi's automatic compaction", async ({ page }) => {
  const harness = await startHarness({ script: () => UNUSED_SCRIPT });
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
    await harness.dispose();
  }
});

// Wiring claim: the pickers show pi's own models and levels, and a chosen level comes back from pi.
test("the status strip lists pi's models and thinking levels", async ({ page }) => {
  const harness = await startHarness({ script: () => UNUSED_SCRIPT });
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
    await harness.dispose();
  }
});

// Wiring claim: send is the row's last control, at the thumb corner and a full touch target.
test("send is the row's last control in the thumb corner at a full touch size", async ({
  page,
}) => {
  const harness = await startHarness({ script: () => UNUSED_SCRIPT });
  try {
    await openHarness(page, harness);
    const labels = await page
      .getByTestId("composer")
      .locator("textarea ~ button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-testid")));
    expect(labels).toEqual(["composer-attach", "composer-branch", "composer-send"]);

    // Each action is a glyph and nothing else, drawn inside the 44 px target rather than clipped by
    // it, on the pack's grid and stroke.
    const actions = await page
      .getByTestId("composer")
      .locator("textarea ~ button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const icon = button.querySelector("svg");
          const glyph = icon?.getBoundingClientRect();
          const target = button.getBoundingClientRect();
          return {
            id: button.getAttribute("data-testid"),
            text: (button.textContent ?? "").trim(),
            icon: icon?.getAttribute("data-icon") ?? null,
            viewBox: icon?.getAttribute("viewBox") ?? null,
            stroke: icon?.getAttribute("stroke-width") ?? null,
            width: glyph?.width ?? 0,
            height: glyph?.height ?? 0,
            contained:
              glyph !== undefined &&
              glyph.left >= target.left - 0.5 &&
              glyph.right <= target.right + 0.5 &&
              glyph.top >= target.top - 0.5 &&
              glyph.bottom <= target.bottom + 0.5,
          };
        }),
      );
    expect(actions.map((action) => action.icon)).toEqual(["paperclip", "git-branch", "arrow-up"]);
    for (const action of actions) {
      expect(action.text, action.id ?? "").toBe("");
      expect(action.viewBox).toBe("0 0 24 24");
      expect(action.stroke).toBe("2");
      expect(action.width).toBeCloseTo(20, 1);
      expect(action.height).toBeCloseTo(20, 1);
      expect(action.contained, `${action.id ?? ""} must not clip its glyph`).toBe(true);
    }

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
    await harness.dispose();
  }
});

// Wiring claim: a keyboard-sized viewport and a rotation leave the composer and send usable.
test("the composer holds up with a keyboard-sized viewport and after rotation", async ({
  page,
}) => {
  const harness = await startHarness({
    script: () => [
      {
        expect: { role: "user", text: "rotated message" },
        reply: { content: [{ type: "text", text: "received after rotation" }], stopReason: "stop" },
      },
    ],
  });
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
    await harness.dispose();
  }
});

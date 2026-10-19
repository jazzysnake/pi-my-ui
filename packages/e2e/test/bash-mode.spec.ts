import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import { startHarness, type Harness } from "../src/test-harness";

const SECRET_SENTINEL = "TOP_SECRET_SENTINEL_42";

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.session.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript-entry").first()).toBeVisible();
}

async function sendCommand(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

const NO_MODEL_CALL: Script = [
  {
    expect: { role: "user", text: "unused" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

test("states the bash mode before the command is sent", async ({ page }) => {
  const harness = await startHarness({ script: () => NO_MODEL_CALL });
  try {
    await openHarness(page, harness);
    const input = page.getByTestId("composer-input");

    await input.fill("!echo hello");
    const include = page.getByTestId("bash-mode-indicator");
    await expect(include).toHaveAttribute("data-bash-mode", "include");
    await expect(include).toContainText("adds to context");
    await expect(include).toContainText(
      "The output will enter the model's context on the next prompt.",
    );

    await input.fill("!!echo secret");
    const exclude = page.getByTestId("bash-mode-indicator");
    await expect(exclude).toHaveAttribute("data-bash-mode", "exclude");
    await expect(exclude).toContainText("not added to context");
    await expect(exclude).toContainText("The output will not enter the model's context.");
  } finally {
    await harness.dispose();
  }
});

test("streams the command's output live and ends with its exit code", async ({ page }) => {
  const harness = await startHarness({ script: () => NO_MODEL_CALL });
  const first = harness.gate("first");
  try {
    await openHarness(page, harness);

    // The typed command holds itself on the gate after its first line, so the gap between the two
    // lines is decided by this test rather than by a sleep that has to be long enough to be safe.
    const command = `echo first; ${first.command("echo second").command}`;
    await sendCommand(page, `!${command}`);

    const card = page.getByTestId("bash-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-bash-status", "running");
    await first.releaseAfter(async () => {
      // The first line arrived while the command was still waiting: output is streamed, not rendered
      // only once pi answers.
      await expect(card.getByTestId("bash-output")).toContainText("first");
      await expect(card.getByTestId("bash-output")).not.toContainText("second");
    });

    await expect(card.getByTestId("bash-output")).toContainText("second");
    await expect(card).toHaveAttribute("data-bash-status", "ok");
    await expect(card.getByTestId("bash-exit")).toHaveText("Exit code 0");
    await expect(card.getByTestId("bash-command")).toHaveText(command);
    await expect(card.getByTestId("bash-mode-label")).toHaveText("! adds to context");
  } finally {
    await harness.dispose();
  }
});

test("shows a non-zero exit as an error", async ({ page }) => {
  const harness = await startHarness({ script: () => NO_MODEL_CALL });
  try {
    await openHarness(page, harness);
    await sendCommand(page, "!exit 3");

    const card = page.getByTestId("bash-card");
    await expect(card).toHaveAttribute("data-bash-status", "error");
    await expect(card.getByTestId("bash-exit")).toHaveText("Exit code 3");
  } finally {
    await harness.dispose();
  }
});

test("the bash card survives a dropped connection and resync", async ({ page }) => {
  const harness = await startHarness({ script: () => NO_MODEL_CALL });
  try {
    await openHarness(page, harness);
    await sendCommand(page, "!echo survive-resync");

    const card = page.getByTestId("bash-card");
    await expect(card).toHaveAttribute("data-bash-status", "ok");
    await expect(card.getByTestId("bash-output")).toContainText("survive-resync");

    expect(harness.server.dropViewerConnections()).toBeGreaterThan(0);
    await expect(page.getByTestId("connection-status")).toHaveAttribute(
      "data-status",
      "reconnecting",
    );
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    // One card, unchanged: the resync re-sends the projected execution rather than re-creating it.
    await expect(page.getByTestId("bash-card")).toHaveCount(1);
    await expect(card.getByTestId("bash-command")).toHaveText("echo survive-resync");
    await expect(card.getByTestId("bash-output")).toContainText("survive-resync");
    await expect(card.getByTestId("bash-exit")).toHaveText("Exit code 0");
  } finally {
    await harness.dispose();
  }
});

test("`!!` output never enters the model's context", async ({ page }) => {
  const harness = await startHarness({
    script: () => [
      {
        expect: {
          role: "user",
          text: "what do you see?",
          contextExcludes: SECRET_SENTINEL,
        },
        reply: { content: [{ type: "text", text: "I see no secret." }], stopReason: "stop" },
      },
    ],
  });
  try {
    await openHarness(page, harness);
    await sendCommand(page, `!!echo ${SECRET_SENTINEL}`);

    const card = page.getByTestId("bash-card");
    await expect(card).toHaveAttribute("data-bash-mode", "exclude");
    await expect(card).toHaveAttribute("data-bash-status", "ok");
    await expect(card.getByTestId("bash-output")).toContainText(SECRET_SENTINEL);

    await sendCommand(page, "what do you see?");

    // The scripted provider fails the run if the sentinel reaches the model, so a reply is proof the
    // output stayed out of the context.
    await expect(page.getByTestId("transcript")).toContainText("I see no secret.");
    await expect(page.getByTestId("run-state")).toHaveCount(0);
  } finally {
    await harness.dispose();
  }
});

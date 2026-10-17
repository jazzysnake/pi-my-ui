import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

// The browser clipboard is a permission, not something the page controls.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const LONG_CODE_LINE = `const panorama = "${"far".repeat(80)}";`;

const MARKDOWN_REPLY = [
  "# Rendering notes",
  "",
  "| Feature | State |",
  "| --- | --- |",
  "| tables | on |",
  "",
  "```ts",
  LONG_CODE_LINE,
  "```",
].join("\n");

// A seeded Session never asks the model anything, but pi still needs a resolvable model.
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
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

async function openHarness(page: Page, harness: Harness, marker: string): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(marker);
}

test("renders assistant markdown, contains a wide code block, and copies raw markdown", async ({
  page,
}) => {
  const harness = await startHarness(
    [
      {
        expect: { role: "user", text: "render the notes" },
        reply: { content: [{ type: "text", text: MARKDOWN_REPLY }], stopReason: "stop" },
      },
    ],
    "plain",
  );
  try {
    await openHarness(page, harness, "Seed text block 3.");

    await page.getByTestId("composer-input").fill("render the notes");
    await page.getByTestId("composer-send").click();

    const markdown = page.getByTestId("markdown");
    await expect(markdown.getByRole("heading", { name: "Rendering notes" })).toBeVisible();
    await expect(markdown.getByRole("table")).toBeVisible();
    await expect(markdown.locator("pre code")).toContainText("const panorama");

    // The fixture line is really wider than the 393px viewport, so the measurement is meaningful.
    const block = await markdown
      .locator("pre")
      .first()
      .evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
    expect(block.scrollWidth).toBeGreaterThan(block.clientWidth);

    const measured = await page.evaluate(() => {
      const transcript = document.querySelector('[data-testid="transcript"]');
      return {
        transcriptScrollWidth: transcript?.scrollWidth ?? 0,
        transcriptClientWidth: transcript?.clientWidth ?? 0,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(measured.transcriptScrollWidth).toBeLessThanOrEqual(measured.transcriptClientWidth);
    expect(measured.documentScrollWidth).toBeLessThanOrEqual(measured.documentClientWidth);

    const assistantRow = page
      .getByTestId("transcript-entry")
      .filter({ hasText: "Rendering notes" });
    const copy = assistantRow.getByTestId("copy-message");
    await expect(copy).toHaveAttribute("aria-label", "Copy message");
    await expect(assistantRow.getByTestId("message-card").getByTestId("copy-message")).toHaveCount(
      1,
    );
    await copy.click();
    await expect(copy).toHaveAttribute("data-copied", "true");
    await expect(copy.locator("svg")).toHaveAttribute("data-icon", "check");
    expect(await copy.evaluate((element) => getComputedStyle(element).color)).toBe(
      "rgb(126, 231, 135)",
    );

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("# Rendering notes");
    expect(clipboard).toContain(LONG_CODE_LINE);
  } finally {
    await disposeHarness(harness);
  }
});

test("the message card keeps its corner control inside the card at 320 px", async ({ page }) => {
  const harness = await startHarness(UNUSED_SCRIPT, "plain");
  try {
    await openHarness(page, harness, "Seed text block 3.");
    await page.setViewportSize({ width: 320, height: 851 });

    const card = page
      .getByTestId("message-card")
      .filter({ has: page.getByTestId("copy-message") })
      .first();
    await expect(card.getByTestId("copy-message")).toBeVisible();

    const measured = await card.evaluate((element) => {
      const control = element.querySelector('[data-testid="copy-message"]');
      const firstBlock = element.querySelector('[data-testid="message-card-first-block"]');
      if (control === null || firstBlock === null) {
        return null;
      }
      const cardBox = element.getBoundingClientRect();
      const controlBox = control.getBoundingClientRect();
      const firstBlockBox = firstBlock.getBoundingClientRect();
      return {
        cardLeft: cardBox.left,
        cardRight: cardBox.right,
        cardTop: cardBox.top,
        cardBottom: cardBox.bottom,
        controlLeft: controlBox.left,
        controlRight: controlBox.right,
        controlTop: controlBox.top,
        controlBottom: controlBox.bottom,
        controlWidth: controlBox.width,
        controlHeight: controlBox.height,
        firstBlockContentRight:
          firstBlockBox.right - parseFloat(getComputedStyle(firstBlock).paddingRight),
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      };
    });
    if (measured === null) {
      throw new Error("the message card is missing its control or first block");
    }

    expect(measured.controlLeft).toBeGreaterThanOrEqual(measured.cardLeft);
    expect(measured.controlRight).toBeLessThanOrEqual(measured.cardRight);
    expect(measured.controlTop).toBeGreaterThanOrEqual(measured.cardTop);
    expect(measured.controlBottom).toBeLessThanOrEqual(measured.cardBottom);
    expect(measured.controlWidth).toBeGreaterThanOrEqual(44);
    expect(measured.controlHeight).toBeGreaterThanOrEqual(44);
    expect(measured.firstBlockContentRight).toBeLessThanOrEqual(measured.controlLeft);
    expect(measured.documentScrollWidth).toBeLessThanOrEqual(measured.documentClientWidth);
  } finally {
    await disposeHarness(harness);
  }
});

test("renders a recorded extension notification as a card in the transcript", async ({ page }) => {
  const harness = await startHarness(UNUSED_SCRIPT, "subagents");
  try {
    await openHarness(page, harness, "Seed text block 9.");

    const card = page.getByTestId("notification-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("notification-summary")).toHaveText("Seed agent 4 completed");
    await expect(card.getByTestId("notification-payload")).toContainText("<task-notification>");
  } finally {
    await disposeHarness(harness);
  }
});

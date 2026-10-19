import { expect, test, type Page } from "@playwright/test";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import {
  generateSession,
  seedSession,
  type FixtureSession,
  type SeedName,
} from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_START_TIMEOUT_MS = 30_000;

/** Never invoked: these tests browse one Session's tree and move its Leaf, they run no turn. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "unused" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** The branching seed's texts: the Leaf, an abandoned branch, and a message to edit and resubmit. */
const LEAF_TEXT = "Seed text block 32.";
const EDIT_TEXT = "Seed text block 20.";
const KEPT_BEFORE_EDIT = "Seed text block 19.";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(seed: SeedName = "branching"): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, seed);
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [launch.cwd],
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

async function openHarness(page: Page, harness: Harness, sessionId: string): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(sessionId)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

function modal(page: Page) {
  return page.getByTestId("message-tree-modal");
}

/** A tree row, scoped to the modal: the transcript's entries carry ids too. */
function row(page: Page, text: string) {
  return modal(page).getByTestId("message-tree-row").filter({ hasText: text });
}

function select(page: Page, text: string): Promise<void> {
  return row(page, text).getByTestId("message-tree-select").click();
}

// Wiring claim: the tree body never scrolls horizontally on a phone.
test("the tree body never scrolls horizontally on a phone", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness, harness.seeded.id);
    await expect(page.getByTestId("transcript")).toContainText(LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await page.getByTestId("composer-input").fill("/tree");
    await page.getByTestId("composer-send").click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page)).toHaveAttribute("role", "dialog");
    // The rows render from pi's own tree, so the measurement below is over real row content.
    await expect(row(page, EDIT_TEXT)).toBeVisible();

    // One line per node on a phone: the rows may be many, the body never widens.
    const overflows = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="message-tree-body"]');
      return body === null ? true : body.scrollWidth > body.clientWidth + 1;
    });
    expect(overflows).toBe(false);
  } finally {
    await disposeHarness(harness);
  }
});

// Wiring claim: the transcript follows the Leaf pi confirmed, and the branch it left stays in the tree.
test("selecting a message moves the Leaf, follows it in the transcript and keeps the old branch", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness, harness.seeded.id);
    await expect(page.getByTestId("transcript")).toContainText(LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    // A user message hands its exact text back to the composer for edit and resubmit.
    await select(page, EDIT_TEXT);
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toHaveValue(EDIT_TEXT);

    // The transcript followed the server-confirmed Leaf: the branch it moved off is gone from it.
    await expect(page.getByTestId("transcript")).toContainText(KEPT_BEFORE_EDIT);
    await expect(page.getByTestId("transcript")).not.toContainText(LEAF_TEXT);

    // The abandoned branch is still in the tree, so a move destroyed nothing.
    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await expect(row(page, LEAF_TEXT)).toHaveCount(0);
    await page.getByTestId("message-tree-search").fill(LEAF_TEXT);
    await expect(modal(page).getByTestId("message-tree-match")).toHaveCount(1);
  } finally {
    await disposeHarness(harness);
  }
});

// Wiring claim: an entry pi records but the UI hides is absent from both the transcript and the tree.
test("a hidden custom message has no tree row, exactly as the transcript has none", async ({
  page,
}) => {
  const home = await createHermeticHome();
  const generated = await generateSession(home, "transcript", {
    transcriptEntries: 8,
    hiddenCustomMessage: true,
  });
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args: launch.args, env: launch.env, provider: launch.provider, model: launch.model },
  });
  const client = await startClientPageServer();
  const harness: Harness = { home, seeded: generated, server, client };
  try {
    await openHarness(page, harness, generated.id);
    await expect(page.getByTestId("transcript")).toContainText("Generated user message 0.", {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).not.toContainText("hidden custom message");

    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await expect(page.getByTestId("message-tree-row").first()).toBeVisible();
    // The hidden entry is a real Session entry, so the tree holds one row fewer than the file and
    // no row carries the text the transcript also refuses to draw.
    expect(await page.getByTestId("message-tree-row").count()).toBe(generated.entryCount - 1);
    await expect(modal(page)).not.toContainText("hidden custom message");
  } finally {
    await disposeHarness(harness);
  }
});

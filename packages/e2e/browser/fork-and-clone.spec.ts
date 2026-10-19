import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_START_TIMEOUT_MS = 30_000;

/**
 * The only prompt any test here sends. It goes to the original after a fork, so a child that forked
 * and was never replaced would write it into the fork's file instead of the original's.
 */
const ORIGINAL_STILL_RUNS_PROMPT = "does the original still run?";
const ORIGINAL_STILL_RUNS_REPLY = "the original still runs";

const SCRIPT: Script = [
  {
    expect: { role: "user", text: ORIGINAL_STILL_RUNS_PROMPT },
    reply: { content: [{ type: "text", text: ORIGINAL_STILL_RUNS_REPLY }], stopReason: "stop" },
  },
];

/** User messages of the branching seed on its active path, and where a fork from one lands. */
const FORK_FROM_TEXT = "Seed text block 20.";
const FORK_KEEPS_TEXT = "Seed text block 19.";
const ACTIVE_BRANCH_LEAF_TEXT = "Seed text block 32.";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "branching");
  const launch = await scriptedPiLaunch(home, SCRIPT);
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

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(ACTIVE_BRANCH_LEAF_TEXT, {
    timeout: PI_START_TIMEOUT_MS,
  });
}

async function sendCommand(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

function sessionRow(page: Page, sessionId: string) {
  return page.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`);
}

/** The opened Session's id, once the shell has switched away from the one it started on. */
async function openedSessionId(page: Page, previousId: string): Promise<string> {
  const shell = page.getByTestId("app-shell");
  await expect(shell).not.toHaveAttribute("data-session-id", previousId);
  const opened = await shell.getAttribute("data-session-id");
  if (opened === null || opened === "") {
    throw new Error("the shell opened no Session");
  }
  return opened;
}

// Wiring claim: pi forks a real Session from the chosen message and leaves the original untouched.
test("/fork branches from a chosen message into a new Session and lists both", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);
    // The original's own branch reaches the message the fork will leave out.
    await expect(page.getByTestId("transcript")).toContainText(FORK_FROM_TEXT);

    await sendCommand(page, "/fork");
    const picker = page.getByTestId("fork-picker");
    await expect(picker).toBeVisible();
    // pi owns the choices, so the picker lists its user messages, not the transcript's entries.
    await expect(picker.getByTestId("fork-picker-row")).toHaveCount(3);
    await picker.getByTestId("fork-picker-row").filter({ hasText: FORK_FROM_TEXT }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId("command-notice")).toHaveText(
      "Fork created a new session, now open.",
    );

    const forkedId = await openedSessionId(page, harness.seeded.id);
    expect(forkedId).not.toBe(harness.seeded.id);
    // The forked Session is the branch *before* the message it was forked from.
    await expect(page.getByTestId("transcript")).toContainText(FORK_KEEPS_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).not.toContainText(FORK_FROM_TEXT);
    await expect(page.getByTestId("transcript")).not.toContainText(ACTIVE_BRANCH_LEAF_TEXT);

    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    await expect(page.getByTestId("session-row")).toHaveCount(2);
    await expect(sessionRow(page, forkedId)).toHaveAttribute("aria-current", "true");
    await expect(sessionRow(page, harness.seeded.id)).not.toHaveAttribute("aria-current", "true");

    // Re-opening the original proves the fork left it exactly as it was.
    await sessionRow(page, harness.seeded.id).click();
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();
    await expect(page.getByTestId("transcript")).toContainText(FORK_FROM_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).toContainText(ACTIVE_BRANCH_LEAF_TEXT);
  } finally {
    await disposeHarness(harness);
  }
});

// Wiring claim: pi clones the active branch into a real Session and both remain listable.
test("/clone copies the active branch into a new Session and lists both", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);

    await sendCommand(page, "/clone");
    await expect(page.getByTestId("command-notice")).toHaveText(
      "Clone created a new session, now open.",
    );

    const clonedId = await openedSessionId(page, harness.seeded.id);
    expect(clonedId).not.toBe(harness.seeded.id);
    // A clone copies the branch as it stands, so the leaf it was cloned at is still there.
    await expect(page.getByTestId("transcript")).toContainText(ACTIVE_BRANCH_LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).toContainText(FORK_FROM_TEXT);

    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    await expect(page.getByTestId("session-row")).toHaveCount(2);
    await expect(sessionRow(page, clonedId)).toHaveAttribute("aria-current", "true");
    await sessionRow(page, harness.seeded.id).click();
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();
    await expect(page.getByTestId("transcript")).toContainText(ACTIVE_BRANCH_LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });
  } finally {
    await disposeHarness(harness);
  }
});

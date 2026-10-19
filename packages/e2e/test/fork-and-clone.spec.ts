import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { ServerMessage } from "@pi-my-ui/protocol";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession, type WsSessionClient } from "../src/ws-session-client";
import { readAttachSurfaces, readUntilText } from "../src/ws-transcript";

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

/** The next frame of one type; the server also pushes lists and attach surfaces on its own. */
async function nextOf<T extends ServerMessage["type"]>(
  client: WsSessionClient,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  for (;;) {
    const message = await client.next();
    if (message.type === type) {
      return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

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

test("a fork writes a new Session file and leaves the original on its own child", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const originalBytes = await readFile(harness.seeded.path, "utf8");

    client.send({
      type: "subscribe",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    const before = await nextOf(client, "snapshot");
    await readAttachSurfaces(client);
    expect(before.projection.leafId).toBe(harness.seeded.leafId);

    client.send({
      type: "getForkMessages",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    const forkMessages = await nextOf(client, "forkMessages");
    const chosen = forkMessages.messages.find((message) => message.text.includes(FORK_FROM_TEXT));
    expect(chosen).toBeDefined();
    if (chosen === undefined) {
      return;
    }

    client.send({
      type: "forkSession",
      session: { project: harness.home.workspace, id: harness.seeded.id },
      entryId: chosen.entryId,
    });
    const rebuilt = await nextOf(client, "snapshot");
    const forked = await nextOf(client, "sessionForked");
    expect(forked.mutation).toBe("fork");
    expect(forked.sourceSession).toEqual({
      project: harness.home.workspace,
      id: harness.seeded.id,
    });
    const forkedId = forked.session?.id;
    expect(forkedId).toBeDefined();
    if (forkedId === undefined) {
      return;
    }
    expect(forkedId).not.toBe(harness.seeded.id);

    // The original's Projection is what it was: a fork copies a branch, it changes nothing here.
    expect(rebuilt.session).toEqual({ project: harness.home.workspace, id: harness.seeded.id });
    expect(rebuilt.projection.leafId).toBe(before.projection.leafId);
    expect(rebuilt.projection.entries).toEqual(before.projection.entries);
    expect(await readFile(harness.seeded.path, "utf8")).toBe(originalBytes);

    // The fork is a real Session file, and the server serves it as one.
    const forkedPath = SessionManager.findById(
      harness.home.workspace,
      forkedId,
      harness.home.sessionsDir,
    );
    expect(forkedPath).toBeDefined();
    if (forkedPath === undefined) {
      return;
    }
    const forkedText = await readFile(forkedPath, "utf8");
    expect(forkedText).toContain(FORK_KEEPS_TEXT);
    expect(forkedText).not.toContain(FORK_FROM_TEXT);

    // The original still has a child of its own: the prompt lands in the original's file, never the
    // fork's, which is what forbids two writers on one file.
    client.send({
      type: "prompt",
      session: { project: harness.home.workspace, id: harness.seeded.id },
      text: ORIGINAL_STILL_RUNS_PROMPT,
    });
    await readUntilText(client, ORIGINAL_STILL_RUNS_REPLY);
    expect(await readFile(harness.seeded.path, "utf8")).toContain(ORIGINAL_STILL_RUNS_PROMPT);
    expect(await readFile(forkedPath, "utf8")).not.toContain(ORIGINAL_STILL_RUNS_PROMPT);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

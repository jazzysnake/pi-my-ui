import { chmodSync, copyFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 150_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** What the delegated agent says while it works, and what its own session file records. */
const AGENT_TEXT = "the build check ran";

/**
 * The parent delegates one blocking task; the agent replies, the parent then finishes. The run is a
 * real pi-subagents run, so the record and the child session it leaves are pi's own, and only the
 * model is scripted.
 */
const SCRIPT: Script = [
  {
    expect: { role: "user", text: "delegate the build" },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_agent_1",
          name: "Agent",
          arguments: {
            subagent_type: "general-purpose",
            prompt: "check the build",
            description: "Check the build",
            run_in_background: false,
          },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "user", text: "check the build" },
    reply: { content: [{ type: "text", text: AGENT_TEXT }], stopReason: "stop" },
  },
  {
    expect: { role: "toolResult", toolName: "Agent" },
    reply: { content: [{ type: "text", text: "the parent finished" }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly launch: Awaited<ReturnType<typeof scriptedPiLaunch>>;
  readonly client: ClientPageServer;
  readonly servers: RunningServer[];
}

/** One hermetic home, one seeded Session, and whichever servers a test starts against them. */
async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, SCRIPT, { piSubagents: true });
  const client = await startClientPageServer();
  return { home, seeded, launch, client, servers: [] };
}

async function startServerFor(harness: Harness): Promise<RunningServer> {
  const server = await startServer({
    cwd: harness.launch.cwd,
    sessionDir: harness.home.sessionsDir,
    port: harness.home.ports.allocate(),
    pi: {
      args: harness.launch.args,
      env: harness.launch.env,
      provider: harness.launch.provider,
      model: harness.launch.model,
    },
  });
  harness.servers.push(server);
  return server;
}

async function stopServer(harness: Harness, server: RunningServer): Promise<void> {
  harness.servers.splice(harness.servers.indexOf(server), 1);
  await server.close();
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  for (const server of harness.servers) {
    await server.close();
  }
  await harness.home.dispose();
}

async function openHarness(page: Page, harness: Harness, server: RunningServer): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

function agentRow(page: Page): ReturnType<Page["getByTestId"]> {
  return page.locator('[data-testid="agent-row"][data-row-kind="agent"]');
}

/** Run one delegated agent to completion, then stop the server so only pi's files remain. */
async function runAgentThenStop(page: Page, harness: Harness): Promise<void> {
  const server = await startServerFor(harness);
  await openHarness(page, harness, server);
  await page.getByTestId("composer-input").fill("delegate the build");
  await page.getByTestId("composer-send").click();

  // The agent is live in this process; its settled record and its own session file are pi's.
  await expect(page.getByTestId("agent-pill")).toBeVisible();
  await page.getByTestId("agent-pill").click();
  await expect(agentRow(page).getByTestId("agent-row-status")).toHaveText("completed", {
    timeout: 60_000,
  });
  await stopServer(harness, server);
}

/** The session files pi-subagents wrote beside the spawning Session, one per run. */
async function childSessionFiles(harness: Harness): Promise<readonly string[]> {
  const names = await readdir(harness.home.sessionsDir);
  return names
    .map((name) => join(harness.home.sessionsDir, name))
    .filter((path) => path !== harness.seeded.path);
}

/** Open the restarted server, focus the Session's agent and answer with what its transcript says. */
async function focusAgentAfterRestart(page: Page, harness: Harness): Promise<void> {
  const second = await startServerFor(harness);
  await openHarness(page, harness, second);
  await page.getByTestId("agent-pill").click();
  await agentRow(page).click();
  await expect(page.getByTestId("agent-list")).toHaveCount(0);
}

test("past subagent runs are listed after a server restart", async ({ page }) => {
  const harness = await startHarness();
  try {
    await runAgentThenStop(page, harness);

    // A fresh server has no live agent records: the run is only in the Session file pi wrote.
    const second = await startServerFor(harness);
    await openHarness(page, harness, second);
    await expect(page.getByTestId("agent-pill")).toBeVisible();
    await page.getByTestId("agent-pill").click();

    const row = agentRow(page);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("agent-row-type")).toHaveText("general-purpose");
    await expect(row.getByTestId("agent-row-status")).toHaveText("completed");
    await expect(row.getByTestId("agent-row-name")).toHaveText(/^@\S+$/);

    // The run's conversation is not in the Session's transcript and was never streamed to this
    // server, so opening it is a read of the run's own session file.
    await row.click();
    await expect(page.getByTestId("agent-list")).toHaveCount(0);
    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText(AGENT_TEXT);
    await expect(transcript).not.toContainText("Seed text block 3.");
  } finally {
    await disposeHarness(harness);
  }
});

test("a settled run with no child session file says its conversation is gone", async ({ page }) => {
  const harness = await startHarness();
  try {
    await runAgentThenStop(page, harness);
    const children = await childSessionFiles(harness);
    expect(children).toHaveLength(1);
    rmSync(children[0] as string);

    await focusAgentAfterRestart(page, harness);

    await expect(page.getByTestId("transcript-empty")).toHaveText(
      /has finished; its conversation is no longer available\.$/,
    );
  } finally {
    await disposeHarness(harness);
  }
});

test("two child sessions matching one run are refused instead of guessed", async ({ page }) => {
  const harness = await startHarness();
  try {
    await runAgentThenStop(page, harness);
    const children = await childSessionFiles(harness);
    expect(children).toHaveLength(1);
    const child = children[0] as string;
    // The same run id in a second file: opening either one would risk showing the wrong run.
    copyFileSync(child, join(harness.home.sessionsDir, `copied_${basename(child)}`));

    await focusAgentAfterRestart(page, harness);

    const empty = page.getByTestId("transcript-empty");
    await expect(empty).toContainText("more than one run or child session matches");
    await expect(page.getByTestId("transcript")).not.toContainText(AGENT_TEXT);
  } finally {
    await disposeHarness(harness);
  }
});

test("an unreadable child session refuses instead of reporting the conversation gone", async ({
  page,
}) => {
  // A root runner reads through the mode bits, so this case cannot be staged there.
  test.skip(process.getuid?.() === 0, "file modes do not deny reads to root");
  const harness = await startHarness();
  try {
    await runAgentThenStop(page, harness);
    const children = await childSessionFiles(harness);
    expect(children).toHaveLength(1);
    chmodSync(children[0] as string, 0o000);

    await focusAgentAfterRestart(page, harness);

    const empty = page.getByTestId("transcript-empty");
    await expect(empty).toContainText("This subagent's transcript is unavailable:");
    await expect(empty).toContainText("could not be read");
    await expect(page.getByTestId("transcript")).not.toContainText(AGENT_TEXT);
  } finally {
    await disposeHarness(harness);
  }
});

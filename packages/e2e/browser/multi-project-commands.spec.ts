import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession } from "../src/fixture-builder";
import type { Gate } from "../src/gate";
import {
  disposeHarness,
  FIRST_MARKER,
  MULTI_PROJECT_START_TIMEOUT_MS as PI_START_TIMEOUT_MS,
  nextFrameOfType,
  openDrawer,
  projectUrl,
  SECOND_MARKER,
  sendMessage,
  startHarness,
} from "../src/multi-project-harness";
import { connectWsSession } from "../src/ws-session-client";

/** What the delegated agent says before it starts the command the steer interrupts. */
const AGENT_TEXT = "watching the build now";
const STEER_TEXT = "tighten the loop";
const STEERED_REPLY = "the agent tightened the loop";

/**
 * A delegated run that stays live on a bash tool until the test opens its gate, so the steer is
 * typed while the agent genuinely works rather than while a fixed sleep drains.
 */
function steeringScript(gate: (name: string) => Gate): Script {
  return [
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
              prompt: "watch the build",
              description: "Watch the build",
              run_in_background: false,
            },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "user", text: "watch the build" },
      reply: {
        content: [
          { type: "text", text: AGENT_TEXT },
          {
            type: "toolCall",
            id: "call_subagent_bash_1",
            name: "bash",
            arguments: { ...gate("build").command("echo built") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "user", text: STEER_TEXT },
      reply: { content: [{ type: "text", text: STEERED_REPLY }], stopReason: "stop" },
    },
    {
      expect: { role: "toolResult", toolName: "Agent" },
      reply: { content: [{ type: "text", text: "the parent finished" }], stopReason: "stop" },
    },
  ];
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

/** Open the agent list from the pill and focus the Session's only agent. */
async function focusAgent(page: Page): Promise<void> {
  await expect(page.getByTestId("agent-pill")).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  await page.getByTestId("agent-pill").click();
  await page.locator('[data-testid="agent-row"][data-row-kind="agent"]').first().click();
  await expect(page.getByTestId("agent-list")).toHaveCount(0);
}

// Wiring claim: fork and clone write into the source Project, and the other Project's list never sees them.
test("fork and clone open their new Session in the source Project", async ({ page }) => {
  const harness = await startHarness();
  const otherClient = await connectWsSession(harness.server.url);
  try {
    await page.goto(projectUrl(harness, harness.second, harness.secondSession.id));
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText(SECOND_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await sendMessage(page, "/clone");
    await expect(page.getByTestId("command-notice")).toHaveText(
      "Clone created a new session, now open.",
    );
    const clonedId = await openedSessionId(page, harness.secondSession.id);
    expect(clonedId).not.toBe(harness.secondSession.id);

    await openDrawer(page);
    await expect(page.getByTestId("session-row")).toHaveCount(2);
    await expect(
      page.locator(`[data-testid="session-row"][data-session-id="${clonedId}"]`),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();

    await sendMessage(page, "/fork");
    const picker = page.getByTestId("fork-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId("fork-picker-row").last()).toBeVisible();
    await picker.getByTestId("fork-picker-row").last().click();
    await expect(page.getByTestId("command-notice")).toHaveText(
      "Fork created a new session, now open.",
    );
    const forkedId = await openedSessionId(page, clonedId);
    expect(forkedId).not.toBe(clonedId);
    expect(forkedId).not.toBe(harness.secondSession.id);

    otherClient.send({ type: "listSessions", project: harness.second });
    const secondList = await nextFrameOfType(otherClient, "sessions");
    expect(secondList.project).toBe(harness.second);
    expect(secondList.sessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([harness.secondSession.id, clonedId, forkedId]),
    );

    otherClient.send({ type: "listSessions", project: harness.first });
    const firstList = await nextFrameOfType(otherClient, "sessions");
    expect(firstList.project).toBe(harness.first);
    const firstIds = firstList.sessions.map((session) => session.id);
    expect(firstIds).not.toContain(clonedId);
    expect(firstIds).not.toContain(forkedId);
  } finally {
    await otherClient.close();
    await disposeHarness(harness);
  }
});

// Wiring claim: a steer reaches a running agent that lives in a Project other than the one on screen.
test("a steer reaches a running agent in another Project", async ({ page }) => {
  const harness = await startHarness(steeringScript);
  const build = harness.gate("build");
  // The branching seed already holds a settled agent; a plain Session keeps the focus on the one
  // this run starts.
  const steeringSession = await seedSession(harness.home, "plain", {
    project: harness.second,
    id: "01a10000-0000-7000-8000-0000000000b4",
    timestamp: "2025-01-02T00:00:01.000Z",
  });
  try {
    await page.goto(projectUrl(harness, harness.second, steeringSession.id));
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await sendMessage(page, "delegate the build");
    await focusAgent(page);

    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText(AGENT_TEXT);

    await page.getByTestId("composer-input").fill(STEER_TEXT);
    await page.getByTestId("composer-send-while-running").click();

    // The agent is held inside its command, so the steer is still on its way when this gate opens.
    // Observing the pending line first is what makes the reply below evidence that pi delivered the
    // text at the turn boundary rather than that the message simply arrived before anything ran.
    await build.releaseAfter(async () => {
      await expect(transcript).toContainText(AGENT_TEXT);
      const pending = page.getByTestId("steer-pending");
      await expect(pending).toBeVisible();
      await expect(pending).toContainText("@");
      await expect(transcript).not.toContainText(STEER_TEXT);
    });

    await expect(transcript).toContainText(STEERED_REPLY, { timeout: PI_START_TIMEOUT_MS });
  } finally {
    await disposeHarness(harness);
  }
});

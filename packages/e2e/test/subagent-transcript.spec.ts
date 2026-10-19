import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import type { Gate } from "../src/gate";
import { startHarness, type Harness } from "../src/test-harness";
import { connectWsSession } from "../src/ws-session-client";
import { projectionText } from "../src/ws-transcript";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** What the focused agent says before it starts a command that outlives the browser's check. */
const AGENT_TEXT = "watching the build now";

/**
 * The parent delegates one task. The agent speaks, then waits on this test's build gate: everything
 * the browser asserts happens while the agent is genuinely working, and the gate decides when the
 * command returns. Only the model is scripted, so the agent, its session and its event stream are
 * pi's.
 */
function buildScript(gate: (name: string) => Gate): Script {
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
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "the agent finished" }], stopReason: "stop" },
    },
    {
      expect: { role: "toolResult", toolName: "Agent" },
      reply: { content: [{ type: "text", text: "the parent finished" }], stopReason: "stop" },
    },
  ];
}

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.session.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

function agentRow(page: Page): ReturnType<Page["getByTestId"]> {
  return page.locator('[data-testid="agent-row"][data-row-kind="agent"]').first();
}

/** Open the agent list from the pill and focus the Session's only agent. */
async function focusAgent(page: Page): Promise<void> {
  await expect(page.getByTestId("agent-pill")).toBeVisible();
  await page.getByTestId("agent-pill").click();
  await agentRow(page).click();
  await expect(page.getByTestId("agent-list")).toHaveCount(0);
}

test("a focused running agent's conversation streams into the transcript view", async ({
  page,
}) => {
  const harness = await startHarness({ script: buildScript, piSubagents: true });
  try {
    await openHarness(page, harness);
    await sendMessage(page, "delegate the build");
    await focusAgent(page);

    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText(AGENT_TEXT);
    // The same view draws one conversation at a time, so the Session's own transcript is not left
    // underneath the agent's.
    await expect(transcript).not.toContainText("Seed text block 3.");

    // The text arrived while the agent was still working: its next step blocks on the build gate,
    // so a run that had already settled could not still be running here. Teardown releases the gate.
    await page.getByTestId("agent-pill").click();
    await expect(agentRow(page).getByTestId("agent-row-status")).toHaveText("running");
  } finally {
    await harness.dispose();
  }
});

test("the focused agent's transcript survives a resync", async ({ page }) => {
  const harness = await startHarness({ script: buildScript, piSubagents: true });
  const build = harness.gate("build");
  try {
    await openHarness(page, harness);
    await sendMessage(page, "delegate the build");
    await focusAgent(page);

    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText(AGENT_TEXT);

    const status = page.getByTestId("connection-status");
    harness.server.dropViewerConnections();
    await expect(status).toHaveAttribute("data-status", "reconnecting");
    await expect(status).toHaveAttribute("data-status", "connected", { timeout: 30_000 });

    // The view stayed on the agent across the drop, and the conversation it was reading is intact.
    await expect(page.getByTestId("agent-pill-label")).toHaveText(/^@/);
    await expect(transcript).toContainText(AGENT_TEXT);

    // A viewer that arrives with no Cursor is served a Snapshot, which must carry the agent's
    // conversation rather than only the Session's own transcript.
    const viewer = await connectWsSession(harness.server.url);
    try {
      viewer.send({
        type: "subscribe",
        session: { project: harness.project, id: harness.session.id },
      });
      const first = await viewer.next();
      if (first.type !== "snapshot") {
        throw new Error(`expected a snapshot, received ${first.type}`);
      }
      const agentText = first.projection.subagentTranscripts
        .map((transcript) => projectionText(transcript.entries))
        .join(" ");
      expect(agentText).toContain(AGENT_TEXT);
    } finally {
      await viewer.close();
    }

    // The run is live now, not merely restored: the agent is still working, blocked on the build
    // gate this test has not opened yet. Opening it last is what makes the final assertion a
    // continuation rather than a re-read of a finished run.
    await build.releaseAfter(async () => {
      await page.getByTestId("agent-pill").click();
      await expect(agentRow(page).getByTestId("agent-row-status")).toHaveText("running");
      // Back to the focused conversation, so the assertion below reads the view the reader sees.
      await page.getByTestId("agent-list-scrim").click();
      await expect(page.getByTestId("agent-list")).toHaveCount(0);
    });

    // The agent's later output reaches the focused view after the resync, so the stream continued
    // into the same rows rather than being restored as a frozen copy.
    await expect(transcript).toContainText("the agent finished", { timeout: 60_000 });
  } finally {
    await harness.dispose();
  }
});

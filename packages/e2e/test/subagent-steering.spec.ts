import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import type { Gate } from "../src/gate";
import { startHarness, type Harness } from "../src/test-harness";

/** What the agent says before it starts the command that outlives the steer. */
const AGENT_TEXT = "watching the build now";
const STEER_TEXT = "tighten the loop";
/** The agent's answer to the steer, so the model call it provoked is visible in the transcript. */
const STEERED_REPLY = "the agent tightened the loop";

/**
 * The parent delegates one task; the agent speaks and then blocks on this test's build gate, so the
 * steer is typed while the agent is genuinely working and the test decides when the tool call
 * returns. pi delivers a steer after the current tool call, so the model call that follows is
 * prompted by the steer itself — the script binds that call to the steer text, which is what proves
 * the text reached this agent and not the Session.
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

/** An agent that finishes on its own, so the composer can be asked to steer a settled run. */
const SETTLED_SCRIPT: Script = [
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
            prompt: "say done",
            description: "Say done",
            run_in_background: false,
          },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "user", text: "say done" },
    reply: { content: [{ type: "text", text: "the agent finished" }], stopReason: "stop" },
  },
  {
    expect: { role: "toolResult", toolName: "Agent" },
    reply: { content: [{ type: "text", text: "the parent finished" }], stopReason: "stop" },
  },
];

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

/** Type into the composer and send while the Session's own run is still streaming. */
async function steer(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send-while-running").click();
}

test("typed text steers the focused running agent and is shown until it lands", async ({
  page,
}) => {
  const harness = await startHarness({ script: steeringScript, piSubagents: true });
  const build = harness.gate("build");
  try {
    await openHarness(page, harness);
    await sendMessage(page, "delegate the build");
    await focusAgent(page);

    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText(AGENT_TEXT);

    await steer(page, STEER_TEXT);

    // The agent is still inside its gated command, so the message is in flight rather than
    // delivered: the status line says where it is, and the agent's conversation has not gained the
    // turn yet. Observing that before the release is what makes this a decision rather than a race.
    const pending = page.getByTestId("steer-pending");
    await build.releaseAfter(async () => {
      await expect(pending).toBeVisible();
      await expect(pending).toContainText("@");
      await expect(transcript).not.toContainText(STEER_TEXT);
    });

    // pi delivers at the turn boundary: the steer becomes a user turn in that agent's conversation
    // and the model call it prompts is the one the script bound to it.
    await expect(transcript).toContainText(STEER_TEXT, { timeout: 30_000 });
    await expect(transcript).toContainText(STEERED_REPLY, { timeout: 30_000 });
    await expect(pending).toHaveCount(0);

    // The Session's own conversation never received the text, so the message went to the agent.
    await page.getByTestId("agent-pill").click();
    await page.locator('[data-testid="agent-row"][data-row-kind="main"]').click();
    await expect(page.getByTestId("transcript")).not.toContainText(STEER_TEXT);
  } finally {
    await harness.dispose();
  }
});

test("a settled agent disables sending and says why", async ({ page }) => {
  const harness = await startHarness({
    script: () => SETTLED_SCRIPT,
    piSubagents: true,
  });
  try {
    await openHarness(page, harness);
    await sendMessage(page, "delegate the build");
    await expect(page.getByTestId("transcript")).toContainText("the parent finished", {
      timeout: 30_000,
    });

    await focusAgent(page);
    await expect(page.getByTestId("transcript")).toContainText("the agent finished");

    await page.getByTestId("composer-input").fill(STEER_TEXT);
    await expect(page.getByTestId("steer-refusal")).toContainText("settled");
    await expect(page.getByTestId("composer-send")).toBeDisabled();

    // A disabled control that still sent would be worse than a tap that does nothing, so the text
    // stays where the user put it and nothing reaches the agent.
    await expect(page.getByTestId("composer-input")).toHaveValue(STEER_TEXT);
    await expect(page.getByTestId("transcript")).not.toContainText(STEER_TEXT);
  } finally {
    await harness.dispose();
  }
});

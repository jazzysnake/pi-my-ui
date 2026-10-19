import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import type { Gate } from "../src/gate";
import { startHarness, type Harness } from "../src/test-harness";

/**
 * A workflow script a model would write for one delegated task. Its single `agent()` call is served
 * by the same scripted provider as every other agent, so the run is real and still deterministic.
 */
const WORKFLOW_SCRIPT = [
  "export const meta = { name: 'quick-check', description: 'one delegated check' }",
  "const reply = await agent('check the output', { label: 'checker' })",
  "return reply",
].join("\n");

/**
 * The parent asks for a subagent that blocks on this test's run gate, so its row can be read while
 * it is genuinely working. The run is a real pi-subagents run; only the model is scripted.
 */
function agentScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: "spawn a helper" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_agent_1",
            name: "Agent",
            arguments: {
              subagent_type: "general-purpose",
              prompt: "say hi slowly",
              description: "Say hi slowly",
              run_in_background: false,
            },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "user", text: "say hi slowly" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_subagent_bash_1",
            name: "bash",
            arguments: { ...gate("subagent-run").command("echo subagent-ran") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: "the subagent finished" }], stopReason: "stop" },
    },
    {
      expect: { role: "toolResult", toolName: "Agent" },
      reply: { content: [{ type: "text", text: "the parent finished" }], stopReason: "stop" },
    },
  ];
}

/** The parent asks for a workflow, whose own agent prompt is scripted too. */
const WORKFLOW_CALL_SCRIPT: Script = [
  {
    expect: { role: "user", text: "run a workflow" },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_workflow_1",
          name: "SubagentWorkflow",
          arguments: { script: WORKFLOW_SCRIPT },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "user", text: "check the output" },
    reply: { content: [{ type: "text", text: "the check passed" }], stopReason: "stop" },
  },
  {
    expect: { role: "toolResult", toolName: "SubagentWorkflow" },
    reply: { content: [{ type: "text", text: "the workflow was started" }], stopReason: "stop" },
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

function row(page: Page, kind: string): ReturnType<Page["getByTestId"]> {
  return page.locator(`[data-testid="agent-row"][data-row-kind="${kind}"]`);
}

test("the list shows each agent's type, name, status and elapsed time, and a row focuses it", async ({
  page,
}) => {
  const harness = await startHarness({ script: agentScript, piSubagents: true });
  const run = harness.gate("subagent-run");
  try {
    await openHarness(page, harness);
    await sendMessage(page, "spawn a helper");
    await expect(page.getByTestId("agent-pill")).toBeVisible();

    await page.getByTestId("agent-pill").click();
    await expect(page.getByTestId("agent-list")).toBeVisible();

    await expect(row(page, "main")).toBeVisible();
    const agentRow = row(page, "agent");
    await expect(agentRow).toHaveCount(1);

    // The row is read while the agent's command is blocked on the gate, so every field describes a
    // run that is genuinely live. Elapsed is read as a shape, because the gate decides its value.
    await run.releaseAfter(async () => {
      await expect(agentRow.getByTestId("agent-row-type")).toHaveText("general-purpose");
      await expect(agentRow.getByTestId("agent-row-name")).toHaveText(/^@\S+$/);
      await expect(agentRow.getByTestId("agent-row-status")).toHaveText(/running|queued/);
      await expect(agentRow.getByTestId("agent-row-elapsed")).toHaveText(/^\d+[smhd]$/);
    });

    // Releasing the gate settles the run, so the status just read was the live one and not a stale
    // row that would have shown a finished agent either way.
    await expect(agentRow.getByTestId("agent-row-status")).toHaveText("completed", {
      timeout: 30_000,
    });

    const handle = (await agentRow.getByTestId("agent-row-name").textContent()) ?? "";
    await agentRow.click();
    await expect(page.getByTestId("agent-list")).toHaveCount(0);
    await expect(page.getByTestId("agent-pill-label")).toHaveText(handle);

    await page.getByTestId("agent-pill").click();
    await row(page, "main").click();
    await expect(page.getByTestId("agent-pill-label")).toHaveText(/^main/);
  } finally {
    await harness.dispose();
  }
});

test("a workflow run is its own row in the list", async ({ page }) => {
  const harness = await startHarness({
    script: () => WORKFLOW_CALL_SCRIPT,
    piSubagents: true,
  });
  try {
    await openHarness(page, harness);
    await sendMessage(page, "run a workflow");

    await expect(page.getByTestId("agent-pill")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("agent-pill").click();

    const workflowRow = row(page, "workflow");
    await expect(workflowRow).toHaveCount(1);
    await expect(workflowRow.getByTestId("agent-row-type")).toHaveText("workflow");
    await expect(workflowRow.getByTestId("agent-row-name")).not.toBeEmpty();
    await expect(workflowRow.getByTestId("agent-row-status")).toHaveText(/running|completed/);
    // A workflow has no conversation of its own and no single agent to focus, so tapping its row
    // must leave the view exactly where it was.
    await workflowRow.click();
    await expect(page.getByTestId("agent-list")).toBeVisible();
    await expect(page.getByTestId("agent-pill")).toHaveAttribute("data-pill-kind", "main");
  } finally {
    await harness.dispose();
  }
});

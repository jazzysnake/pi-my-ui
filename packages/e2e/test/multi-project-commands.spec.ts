import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { TreeNode } from "@pi-my-ui/protocol";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession } from "../src/fixture-builder";
import {
  disposeHarness,
  FIRST_MARKER,
  MULTI_PROJECT_START_TIMEOUT_MS as PI_START_TIMEOUT_MS,
  nextOf,
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

/** A delegated run that stays live long enough for the steer to arrive while it works. */
const STEERING_SCRIPT: Script = [
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
          arguments: { command: "sleep 12 && echo built", timeout: 60 },
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

/** Every node of a message tree, depth first. */
function flattenTree(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
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

test("a bare sessionId is refused for every Session command", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const bare = (fields: Readonly<Record<string, unknown>>) => ({
      ...fields,
      sessionId: harness.secondSession.id,
    });
    const commands = [
      bare({ type: "bash", command: "echo hi", excludeFromContext: false }),
      bare({ type: "setModel", provider: "scripted", modelId: "scripted" }),
      bare({ type: "setThinkingLevel", level: "low" }),
      bare({ type: "setAutoCompaction", enabled: true }),
      bare({ type: "compact" }),
      bare({ type: "getSessionStats" }),
      bare({ type: "setSessionName", name: "a name" }),
      bare({ type: "exportSession" }),
      bare({ type: "getForkMessages" }),
      bare({ type: "forkSession", entryId: harness.secondSession.leafId ?? "entry" }),
      bare({ type: "cloneSession" }),
      bare({ type: "getTree" }),
      bare({ type: "moveLeaf", entryId: harness.secondSession.leafId ?? "entry" }),
      bare({ type: "reconnect" }),
      bare({ type: "steerSubagent", agentId: "agent-1", message: "go on" }),
      bare({ type: "getSubagentTranscript", agentId: "agent-1" }),
    ];

    for (const command of commands) {
      client.send(command);
      expect(await client.next()).toMatchObject({
        type: "error",
        error: { code: "malformedPayload" },
      });
    }
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

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
    const secondList = await nextOf(otherClient, "sessions");
    expect(secondList.project).toBe(harness.second);
    expect(secondList.sessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([harness.secondSession.id, clonedId, forkedId]),
    );

    otherClient.send({ type: "listSessions", project: harness.first });
    const firstList = await nextOf(otherClient, "sessions");
    expect(firstList.project).toBe(harness.first);
    const firstIds = firstList.sessions.map((session) => session.id);
    expect(firstIds).not.toContain(clonedId);
    expect(firstIds).not.toContain(forkedId);
  } finally {
    await otherClient.close();
    await disposeHarness(harness);
  }
});

test("exporting a Session writes inside its own Project", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({
      type: "subscribe",
      session: { project: harness.second, id: harness.secondSession.id },
    });
    expect((await nextOf(client, "snapshot")).session).toEqual({
      project: harness.second,
      id: harness.secondSession.id,
    });

    client.send({
      type: "exportSession",
      session: { project: harness.second, id: harness.secondSession.id },
    });
    const exported = await nextOf(client, "sessionExported");
    expect(exported.session).toEqual({
      project: harness.second,
      id: harness.secondSession.id,
    });

    const written = resolve(harness.second, exported.path);
    const fromSecond = relative(harness.second, written);
    expect(isAbsolute(fromSecond) || fromSecond.startsWith("..")).toBe(false);
    expect(await readFile(written, "utf8")).toContain("<html");

    const fromFirst = relative(harness.first, written);
    expect(isAbsolute(fromFirst) || fromFirst.startsWith("..")).toBe(true);
    await expect(access(resolve(harness.first, exported.path))).rejects.toThrow();
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("the tree and a Leaf move run through a Project's own pair", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.second, id: harness.secondSession.id };
    client.send({ type: "subscribe", session });
    expect((await nextOf(client, "snapshot")).session).toEqual(session);

    client.send({ type: "getTree", session });
    const tree = await nextOf(client, "sessionTree");
    expect(tree.session).toEqual(session);
    expect(tree.tree.leafId).toBe(harness.secondSession.leafId);

    const userNode = flattenTree(tree.tree.roots).find((node) => node.entry.role === "user");
    expect(userNode).toBeDefined();
    if (userNode === undefined) {
      return;
    }

    client.send({ type: "moveLeaf", session, entryId: userNode.entry.id });
    const moved = await nextOf(client, "leafMoved");
    expect(moved.session).toEqual(session);
    expect(moved.entryId).toBe(userNode.entry.id);
    expect(moved.leafId).toBe(userNode.entry.parentId);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("reconnect respawns a Session through its Project's pair", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.second, id: harness.secondSession.id };
    client.send({ type: "subscribe", session });
    expect((await nextOf(client, "snapshot")).session).toEqual(session);

    client.send({ type: "reconnect", session });
    const respawned = await nextOf(client, "snapshot");
    expect(respawned.session).toEqual(session);
    expect(respawned.projection.leafId).toBe(harness.secondSession.leafId);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("a settled subagent's transcript is read through its Project's pair", async () => {
  const harness = await startHarness();
  const agentSession = await seedSession(harness.home, "subagents", {
    project: harness.second,
    id: "01a10000-0000-7000-8000-0000000000b3",
    timestamp: "2025-01-02T00:00:00.000Z",
  });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.second, id: agentSession.id };
    client.send({ type: "subscribe", session });
    const snapshot = await nextOf(client, "snapshot");
    expect(snapshot.session).toEqual(session);
    const agent = snapshot.projection.subagents[0];
    expect(agent).toBeDefined();
    if (agent === undefined) {
      return;
    }

    client.send({ type: "getSubagentTranscript", session, agentId: agent.id });
    const transcript = await nextOf(client, "subagentTranscript");
    expect(transcript.session).toEqual(session);
    expect(transcript.agentId).toBe(agent.id);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("a steer reaches a running agent in another Project", async ({ page }) => {
  const harness = await startHarness(STEERING_SCRIPT);
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
    await expect(transcript).toContainText(STEERED_REPLY, { timeout: 60_000 });
  } finally {
    await disposeHarness(harness);
  }
});

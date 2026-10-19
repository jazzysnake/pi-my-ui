import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { expect, test } from "vitest";

import type { TreeNode } from "@pi-my-ui/protocol";

import { seedSession } from "../src/fixture-builder";
import { disposeHarness, nextOf, startHarness } from "../src/multi-project-server-harness";
import { connectWsSession } from "../src/ws-session-client";

/** Every node of a message tree, depth first. */
function flattenTree(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
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

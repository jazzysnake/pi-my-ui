import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";
import type { ServerMessage, SessionTree, TreeNode } from "@pi-my-ui/protocol";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";
import { readAttachSurfaces } from "../src/ws-transcript";

/** Never invoked: this test browses one Session's tree and moves its Leaf, it runs no turn. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "unused" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** The branching seed's texts: an abandoned branch and a message to edit and resubmit. */
const EDIT_TEXT = "Seed text block 20.";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "branching");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args: launch.args, env: launch.env, provider: launch.provider, model: launch.model },
  });
  return { home, seeded, server };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.server.close();
  await harness.home.dispose();
}

function flatten(nodes: readonly TreeNode[], found: TreeNode[] = []): TreeNode[] {
  for (const node of nodes) {
    found.push(node);
    flatten(node.children, found);
  }
  return found;
}

/** The next frame of one type; the server also pushes lists and attach surfaces on its own. */
async function nextOf<T extends ServerMessage["type"]>(
  client: Awaited<ReturnType<typeof connectWsSession>>,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  for (;;) {
    const message = await client.next();
    if (message.type === type) {
      return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

test("a Leaf move is confirmed by pi, and an unconfirmed one is refused honestly", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const fileBytes = await readFile(harness.seeded.path, "utf8");
    client.send({
      type: "subscribe",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    const snapshot = await nextOf(client, "snapshot");
    await readAttachSurfaces(client);

    client.send({
      type: "getTree",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    const tree: SessionTree = (await nextOf(client, "sessionTree")).tree;
    expect(tree.leafId).toBe(harness.seeded.leafId);
    const nodes = flatten(tree.roots);
    const edited = nodes.find((node) => node.entry.text === EDIT_TEXT);
    expect(edited?.entry.role).toBe("user");
    if (edited === undefined) {
      return;
    }

    client.send({
      type: "moveLeaf",
      session: { project: harness.home.workspace, id: harness.seeded.id },
      entryId: edited.entry.id,
    });
    const confirmed = await nextOf(client, "leafMoved");
    // pi moves a user message's Leaf to its parent, which is what makes it resubmittable.
    expect(confirmed.entryId).toBe(edited.entry.id);
    expect(confirmed.leafId).toBe(edited.entry.parentId);
    expect(confirmed.leafId).not.toBe(snapshot.projection.leafId);

    // A moved Leaf is a pointer, not an edit: the Session file is exactly as it was, so the branch
    // the Session left is still there.
    expect(await readFile(harness.seeded.path, "utf8")).toBe(fileBytes);

    // An id this Session does not hold is refused, with the entry named so the client can attach the
    // refusal to the row that asked.
    client.send({
      type: "moveLeaf",
      session: { project: harness.home.workspace, id: harness.seeded.id },
      entryId: "not-an-entry",
    });
    const refused = await nextOf(client, "error");
    expect(refused.error.code).toBe("commandFailed");
    expect(refused.error.detail).toBe("not-an-entry");
    expect(refused.session).toEqual({ project: harness.home.workspace, id: harness.seeded.id });

    // The refusal left the Leaf where the confirmed move put it.
    client.send({
      type: "getTree",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    expect((await nextOf(client, "sessionTree")).tree.leafId).toBe(confirmed.leafId);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

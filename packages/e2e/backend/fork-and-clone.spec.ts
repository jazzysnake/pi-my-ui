import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { ServerMessage } from "@pi-my-ui/protocol";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession, type WsSessionClient } from "../src/ws-session-client";
import { readAttachSurfaces, readUntilText } from "../src/ws-transcript";

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

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
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
  return { home, seeded, server };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.server.close();
  await harness.home.dispose();
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

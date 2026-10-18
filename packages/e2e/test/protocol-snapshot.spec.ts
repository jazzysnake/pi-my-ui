import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import { EntryKind, type ProjectedEntry } from "@pi-my-ui/protocol";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { piChildPids } from "../src/pi-processes";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";

const PI_TEST_TIMEOUT_MS = 90_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

// The seeded Session never asks the model anything, but pi still has to be launched with a model
// it can resolve, and the scripted provider is the only model substitute the suite has.
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
  });
  return { home, seeded, server };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.server.close();
  await harness.home.dispose();
}

/** The plain text of a projected message entry, in block order. */
function entryText(entry: ProjectedEntry): string {
  return entry.kind !== EntryKind.Message
    ? ""
    : entry.blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
}

test("a WebSocket client receives a correct Snapshot for a seeded Session", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({
      type: "subscribe",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    const message = await client.next();

    expect(message.type).toBe("snapshot");
    if (message.type !== "snapshot") {
      return;
    }
    expect(message.session).toEqual({ project: harness.home.workspace, id: harness.seeded.id });
    expect(message.cursor).toBeGreaterThan(0);
    expect(message.projection.sessionId).toBe(harness.seeded.id);
    expect(message.projection.leafId).toBe(harness.seeded.leafId);

    // The Snapshot is pi's own projection of the committed seed, so these literals are read from
    // the seed file rather than recomputed here.
    expect(message.projection.entries[0]).toMatchObject({
      id: "ede235b1",
      role: "user",
      blocks: [{ type: "text", text: "Seed text block 3." }],
    });
    expect(message.projection.entries.at(-1)?.id).toBe(harness.seeded.leafId);
    expect(
      message.projection.entries.some((entry) => entryText(entry) === "Seed text block 54."),
    ).toBe(true);
    expect(
      message.projection.entries.some(
        (entry) =>
          entry.kind === EntryKind.Message &&
          entry.blocks.some((block) => block.type === "toolCall"),
      ),
    ).toBe(true);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("a Projects request answers with the served Projects in order and starts no Pi child", async () => {
  const home = await createHermeticHome();
  const second = join(home.root, "second-project");
  await mkdir(second, { recursive: true });
  const projects = [await realpath(home.workspace), await realpath(second)];
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects,
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
  });
  const client = await connectWsSession(server.url);
  try {
    client.send({ type: "listProjects" });
    expect(await client.next()).toEqual({ type: "projects", projects });
    // Answering the list is a registry read, not a reason to seat a child anywhere.
    expect(piChildPids()).toEqual([]);
  } finally {
    await client.close();
    await server.close();
    await home.dispose();
  }
});

test("malformed and unknown inbound messages are rejected loudly", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({ type: "not-a-real-message" });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "unknownType" },
    });

    client.sendRaw("{ this is not json");
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "malformedPayload" },
    });

    client.send({ type: "subscribe" });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "malformedPayload" },
    });

    // A Session is named by the pair on the wire, so a frame carrying only a bare id is a protocol
    // error rather than a lookup with the Project guessed.
    client.send({ type: "subscribe", sessionId: harness.seeded.id });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "malformedPayload" },
    });

    client.send({
      type: "subscribe",
      session: { project: harness.home.workspace, id: "not-a-session" },
    });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "unknownSession" },
    });

    // Every rejection was answered and none was coerced: the same connection still serves a real
    // Snapshot.
    client.send({
      type: "subscribe",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    const snapshot = await client.next();
    expect(snapshot.type).toBe("snapshot");
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

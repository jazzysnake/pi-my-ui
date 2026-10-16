import { expect, test } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";
import { projectionText, readUntilText } from "../src/ws-transcript";

const PI_TEST_TIMEOUT_MS = 90_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const PROMPT = "produce output while away";
const REPLY = "output produced while away";

const SCRIPT: Script = [
  {
    expect: { role: "user", text: PROMPT },
    reply: { content: [{ type: "text", text: REPLY }], stopReason: "stop" },
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
  const launch = await scriptedPiLaunch(home, SCRIPT);
  const server = await startServer({
    cwd: launch.cwd,
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

test("a client reattaching at a known Cursor receives the missed Deltas", async () => {
  const harness = await startHarness();
  const writer = await connectWsSession(harness.server.url);
  let detachedAt: number;
  try {
    writer.send({ type: "subscribe", sessionId: harness.seeded.id });
    const snapshot = await writer.next();
    expect(snapshot.type).toBe("snapshot");
    if (snapshot.type !== "snapshot") {
      return;
    }
    detachedAt = snapshot.cursor;

    writer.send({ type: "prompt", sessionId: harness.seeded.id, text: PROMPT });
    const missed = await readUntilText(writer, REPLY);
    expect(missed.at(-1)?.cursor).toBeGreaterThan(detachedAt);
  } finally {
    await writer.close();
  }

  const reader = await connectWsSession(harness.server.url);
  try {
    reader.send({ type: "subscribe", sessionId: harness.seeded.id, cursor: detachedAt });
    const first = await reader.next();
    expect(first.type).toBe("delta");
    if (first.type !== "delta") {
      return;
    }
    expect(first.fromCursor).toBe(detachedAt);

    const replayed = await readUntilText(reader, REPLY, [first]);
    expect(replayed.length).toBeGreaterThan(0);
  } finally {
    await reader.close();
    await disposeHarness(harness);
  }
});

test("an unknown Cursor is answered with a fresh Snapshot", async () => {
  const harness = await startHarness();
  const reader = await connectWsSession(harness.server.url);
  try {
    // Zero is older than any Cursor the seeded Session can be at, so the server cannot bridge it.
    reader.send({ type: "subscribe", sessionId: harness.seeded.id, cursor: 0 });
    const stale = await reader.next();
    expect(stale.type).toBe("snapshot");
    if (stale.type !== "snapshot") {
      return;
    }
    expect(projectionText(stale.projection.entries)).toContain("Seed text block 3.");

    // A Cursor ahead of the stream is unknown for the same reason.
    reader.send({
      type: "subscribe",
      sessionId: harness.seeded.id,
      cursor: stale.cursor + 1_000,
    });
    const ahead = await reader.next();
    expect(ahead.type).toBe("snapshot");
  } finally {
    await reader.close();
    await disposeHarness(harness);
  }
});

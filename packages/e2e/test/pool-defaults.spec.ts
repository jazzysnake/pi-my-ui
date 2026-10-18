import { expect, test } from "@playwright/test";

import { LAUNCHER_USAGE, startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { generateSession, seedSession } from "../src/fixture-builder";
import { createManualClock, type ManualClock } from "../src/manual-clock";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { piChildPids } from "../src/pi-processes";
import { connectWsSession, type WsSessionClient } from "../src/ws-session-client";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/**
 * The default idle window, in seconds, as `--help` states it: the pool's footprint is the measured
 * cost of every child it keeps, so a reader's window and the pool's must be one number.
 */
const DOCUMENTED_DEFAULT_SECONDS = 120;
const DOCUMENTED_DEFAULT_MS = DOCUMENTED_DEFAULT_SECONDS * 1_000;

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly server: RunningServer;
  readonly clock: ManualClock;
}

/** A server that keeps every default, including the idle window, with time under a spec's control. */
async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const clock = createManualClock();
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
    clock: clock.clock,
  });
  return { home, server, clock };
}

async function dispose(harness: Harness): Promise<void> {
  await harness.server.close();
  await harness.home.dispose();
}

/**
 * Subscribe and wait for the attach to settle, which is the point a later close detaches from:
 * the context figure is the last thing attach sends, so receiving it means the subscription is
 * registered and the socket owns a detach.
 */
async function open(
  server: RunningServer,
  project: string,
  sessionId: string,
): Promise<WsSessionClient> {
  const client = await connectWsSession(server.url);
  client.send({ type: "subscribe", session: { project, id: sessionId } });
  let snapshot = false;
  for (;;) {
    const message = await client.next();
    if (message.type === "error") {
      throw new Error(`subscribing to ${sessionId} was refused: ${message.error.code}`);
    }
    if (message.type === "snapshot") {
      expect(message.session.id).toBe(sessionId);
      snapshot = true;
      continue;
    }
    if (message.type === "contextUsage" && snapshot) {
      return client;
    }
  }
}

function documentedDefaultSeconds(): number {
  const line = LAUNCHER_USAGE.split("\n").find((row) => row.includes("--idle-timeout"));
  expect(line).toBeDefined();
  const match = /default: (\d+)\)/.exec(line ?? "");
  expect(match).not.toBeNull();
  return Number.parseInt(match?.[1] ?? "", 10);
}

/** Let real time pass while the server's clock stays put, for the child's own I/O to land. */
async function settle(ms = 100): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("the idle window --help documents is the one the pool evicts on", async () => {
  expect(documentedDefaultSeconds()).toBe(DOCUMENTED_DEFAULT_SECONDS);

  const harness = await startHarness();
  try {
    const watched = await seedSession(harness.home, "plain");
    const abandoned = await generateSession(harness.home, "transcript", { transcriptEntries: 20 });

    const watchedViewer = await open(harness.server, harness.home.workspace, watched.id);
    await expect.poll(() => piChildPids().length).toBe(1);
    const watchedChild = piChildPids()[0];

    const abandonedViewer = await open(harness.server, harness.home.workspace, abandoned.id);
    await expect.poll(() => piChildPids().length).toBe(2);
    const abandonedChild = piChildPids().find((pid) => pid !== watchedChild);
    expect(abandonedChild).toBeDefined();

    // Nothing watches the abandoned Session from here, so its idle window starts now.
    await abandonedViewer.close();
    await settle();

    harness.clock.advance(DOCUMENTED_DEFAULT_MS - 1);
    await settle();
    expect(piChildPids()).toContain(abandonedChild);

    harness.clock.advance(1);
    await expect.poll(() => piChildPids()).toEqual([watchedChild]);
    // The watched Session is untouched: a window only ever applies to a Session nobody watches.
    await watchedViewer.close();

    // The evicted Session still opens, from the child's own Session file.
    const reopened = await open(harness.server, harness.home.workspace, abandoned.id);
    await reopened.close();
  } finally {
    await dispose(harness);
  }
});

test("switching Session before the first Snapshot is built leaves neither Session watching", async () => {
  const harness = await startHarness();
  try {
    const first = await seedSession(harness.home, "plain");
    const second = await generateSession(harness.home, "transcript", { transcriptEntries: 20 });

    // One socket, two subscriptions: the second arrives while the first Session's child is still
    // starting, so the first attach finishes with a detach the socket no longer owns.
    const viewer = await connectWsSession(harness.server.url);
    viewer.send({ type: "subscribe", session: { project: harness.home.workspace, id: first.id } });
    viewer.send({ type: "subscribe", session: { project: harness.home.workspace, id: second.id } });
    await expect.poll(() => piChildPids().length).toBe(2);
    await viewer.close();

    // The subscriptions finish on their own after the socket is gone. A bounded wait lets that
    // setup and its detaches land before the clock moves, so the window starts from a settled pool.
    // A detach dropped on the way is never called again, and its Session keeps a child for as long
    // as the server runs.
    await settle(2_000);
    harness.clock.advance(DOCUMENTED_DEFAULT_MS);
    await expect.poll(() => piChildPids()).toEqual([]);
  } finally {
    await dispose(harness);
  }
});

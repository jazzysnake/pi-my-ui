import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import {
  EntryKind,
  ProjectionDeltaKind,
  type CompactionBoundaryEntry,
  type ContextUsage,
  type ServerMessage,
} from "@pi-my-ui/protocol";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";

const SUMMARY = "The session had read the API surface and agreed on the next step.";

/**
 * pi's own compaction settings, written into the hermetic home. The committed seeds are small, so
 * the default keep-recent budget would keep every message and pi would refuse to compact at all;
 * a small budget is a real pi setting, not a stand-in for pi.
 */
const COMPACTION_SETTINGS = {
  compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 100 },
};

/**
 * The model calls a manual compaction can make: pi summarizes the history, then, when the cut splits
 * a turn, that turn's earlier half. A seed whose cut leaves no history makes only the second call.
 */
function compactionSteps(customInstructions?: string): Script {
  return [
    {
      expect:
        customInstructions === undefined
          ? { role: "compaction" }
          : { role: "compaction", customInstructions },
      reply: { content: [{ type: "text", text: SUMMARY }], stopReason: "stop" },
    },
    {
      expect: { role: "user", text: MEASURE_AFTER_COMPACTION_PROMPT },
      reply: {
        content: [{ type: "text", text: MEASURE_AFTER_COMPACTION_REPLY }],
        stopReason: "stop",
      },
    },
  ];
}

/** A follow-up turn, because pi measures the compacted context on the next model call. */
const MEASURE_AFTER_COMPACTION_PROMPT = "measure the compacted context";
const MEASURE_AFTER_COMPACTION_REPLY = "the compacted context was measured";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
}

async function startHarness(script: Script, seed: SeedName = "plain"): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, seed);
  await mkdir(home.agentDir, { recursive: true });
  await writeFile(
    join(home.agentDir, "settings.json"),
    `${JSON.stringify(COMPACTION_SETTINGS, null, 2)}\n`,
    "utf8",
  );
  const launch = await scriptedPiLaunch(home, script);
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

/** The compaction boundaries one frame announces, if any. */
function boundaryEntries(message: ServerMessage | null): readonly CompactionBoundaryEntry[] {
  if (message === null || message.type !== "delta") {
    return [];
  }
  return message.deltas.flatMap((delta) =>
    delta.kind === ProjectionDeltaKind.EntryUpsert &&
    delta.entry.kind === EntryKind.CompactionBoundary
      ? [delta.entry]
      : [],
  );
}

function compactingAt(frames: readonly ServerMessage[]): number {
  return frames.findIndex(
    (message) =>
      message.type === "delta" &&
      message.deltas.some(
        (delta) =>
          delta.kind === ProjectionDeltaKind.RunState && delta.runState.kind === "compacting",
      ),
  );
}

function boundaryAt(frames: readonly ServerMessage[]): number {
  return frames.findIndex((message) => boundaryEntries(message).length > 0);
}

/** The first context figure after `from`, which is the one pi reports once the compaction ended. */
function usageAfter(
  frames: readonly ServerMessage[],
  from: number,
): ContextUsage | null | undefined {
  const message = frames.slice(from + 1).find((frame) => frame.type === "contextUsage");
  return message?.type === "contextUsage" ? message.contextUsage : undefined;
}

/** The first context figure a Session reports, which every attach sends. */
function usageIn(frames: readonly ServerMessage[]): ContextUsage | null | undefined {
  const message = frames.find((frame) => frame.type === "contextUsage");
  return message?.type === "contextUsage" ? message.contextUsage : undefined;
}

test("the Session reports compaction in progress before the boundary and the remeasured figure", async () => {
  const harness = await startHarness(compactionSteps());
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({
      type: "subscribe",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });
    expect((await client.next()).type).toBe("snapshot");

    const frames: ServerMessage[] = [];
    while (usageIn(frames) === undefined) {
      frames.push(await client.next());
    }
    const before = usageIn(frames);

    client.send({
      type: "compact",
      session: { project: harness.home.workspace, id: harness.seeded.id },
    });

    // The order is the point, so it is read from the stream rather than timed in a browser: a
    // compaction is reported as running, then as a boundary, then with pi's remeasured figure.
    for (let read = 0; read < 200; read += 1) {
      const boundary = boundaryAt(frames);
      if (
        compactingAt(frames) !== -1 &&
        boundary !== -1 &&
        usageAfter(frames, boundary) !== undefined
      ) {
        break;
      }
      frames.push(await client.next());
    }

    expect(compactingAt(frames)).toBeGreaterThan(-1);
    expect(boundaryAt(frames)).toBeGreaterThan(compactingAt(frames));
    const after = usageAfter(frames, boundaryAt(frames));
    if (after === undefined) {
      throw new Error("no context figure followed the compaction boundary");
    }
    // pi has re-read the figure: it is recomputing, or it measured the summary plus what it kept,
    // which is less context than the pre-compaction figure.
    expect(after === null || after.tokens === null || after.tokens < (before?.tokens ?? 0)).toBe(
      true,
    );

    const boundary = boundaryEntries(frames[boundaryAt(frames)] ?? null)[0];
    expect(boundary?.summary).toContain(SUMMARY);
    expect(boundary?.tokensBefore).toBeGreaterThan(0);
    expect(boundary?.firstKeptEntryId).not.toBe("");
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

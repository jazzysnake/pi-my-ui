import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import type { ServerMessage } from "@pi-my-ui/protocol";
import { startServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";
import { readUntilText } from "../src/ws-transcript";

/**
 * Re-records the `ServerMessage` sequences the layer-2 store tests feed. This is an instrument, not
 * a gate: it runs real pi with the scripted provider and records the server's own frames, so the
 * committed fixture is a real run rather than a hand-assembled transcript.
 *
 * Run it with `npm run capture:store-sequences` after `npm run build`.
 */

test.describe.configure({ timeout: 120_000 });

const OUTPUT = fileURLToPath(
  new URL("../../client/test/fixtures/recorded-server-messages.json", import.meta.url),
);

const PROMPT = "stream a reply";
const REPLY = "A streamed answer recorded from a real server run.";

const SCRIPT: Script = [
  {
    expect: { role: "user", text: PROMPT },
    reply: { content: [{ type: "text", text: REPLY }], stopReason: "stop" },
  },
];

const NOT_TRANSCRIPT_STATE = new Set(["sessions", "settings", "commands", "contextUsage"]);

function isIdleRunState(message: ServerMessage): boolean {
  return (
    message.type === "delta" &&
    message.deltas.some((delta) => delta.kind === "runState" && delta.runState.kind === "idle")
  );
}

/** Transcript frames from a subscription until one of `stop` matches; attach surfaces are skipped. */
async function collect(
  client: Awaited<ReturnType<typeof connectWsSession>>,
  stop: (message: ServerMessage) => boolean,
): Promise<ServerMessage[]> {
  const frames: ServerMessage[] = [];
  for (;;) {
    const message = await client.next();
    if (message.type === "snapshot" || message.type === "delta") {
      frames.push(message);
      if (stop(message)) {
        return frames;
      }
      continue;
    }
    if (NOT_TRANSCRIPT_STATE.has(message.type)) {
      continue;
    }
    throw new Error(`unexpected server message during capture: ${message.type}`);
  }
}

test("record the streaming and resync ServerMessage sequences", async () => {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, SCRIPT);
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
  const piVersion = JSON.parse(await readFile(join(getPackageDir(), "package.json"), "utf8")) as {
    version: string;
  };
  try {
    const writer = await connectWsSession(server.url);
    const streaming: ServerMessage[] = [];
    let resyncSnapshot: ServerMessage;
    try {
      writer.send({ type: "subscribe", sessionId: seeded.id });
      streaming.push(...(await collect(writer, (message) => message.type === "snapshot")));
      writer.send({ type: "prompt", sessionId: seeded.id, text: PROMPT });
      const untilReply = await readUntilText(writer, REPLY);
      for (const delta of untilReply) {
        if (!streaming.some((frame) => frame.type === "delta" && frame.cursor === delta.cursor)) {
          streaming.push(delta);
        }
      }
      // Finish the run so the capture ends where a settled Session does, not mid-stream.
      streaming.push(...(await collect(writer, isIdleRunState)));

      // A respawn rebuilds the Projection from the Session file and sends every viewer a fresh
      // Snapshot: the same replacement a resync sends, with pi's durable entry ids instead of the
      // provisional ones a live stream carries.
      writer.send({ type: "reconnect", sessionId: seeded.id });
      const resyncFrames = await collect(writer, (message) => message.type === "snapshot");
      const snapshot = resyncFrames.at(-1);
      if (snapshot === undefined || snapshot.type !== "snapshot") {
        throw new Error("the reconnect did not produce a Snapshot");
      }
      resyncSnapshot = snapshot;
    } finally {
      await writer.close();
    }

    const capture = {
      provenance: {
        command: "npm run capture:store-sequences",
        piVersion: piVersion.version,
        session: "plain seed, real pi with the scripted provider",
        prompt: PROMPT,
        reply: REPLY,
      },
      streaming,
      resync: [...streaming, resyncSnapshot],
    };
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    process.stderr.write(`[capture] wrote ${OUTPUT}\n`);
  } finally {
    await server.close();
    await home.dispose();
  }
});

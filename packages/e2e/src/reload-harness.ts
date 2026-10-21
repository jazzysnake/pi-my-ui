/**
 * One real server over two served Projects, its gates, its seeded Sessions and the WebSocket steps
 * both reload specs read. The mechanism spec and the refusals spec drive the same server and the
 * same frames, so this lives here rather than in one of them: a copy would drift the moment one spec
 * learns a new step.
 */

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";
import type { ServerMessage, SessionRef, SnapshotMessage } from "@pi-my-ui/protocol";

import { seedSession, type FixtureSession } from "./fixture-builder";
import { createGates, type Gate, type OwnedGates } from "./gate";
import { disposeHarnessInOrder } from "./harness-teardown";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "./pi-harness";
import type { WsSessionClient } from "./ws-session-client";

/** A script, or a builder for one: a command that must outlive the assertion names a gate. */
export type ScriptSource = Script | ((gate: (name: string) => Gate) => Script);

/** The seeded Session never asks the model anything, but pi still needs a model it can resolve. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** A skill pi finds only by reading its agent directory at startup. */
const SKILL = "reloaded-skill";
export const SKILL_COMMAND = `skill:${SKILL}`;

export interface Harness {
  readonly home: HermeticHome;
  readonly first: string;
  readonly second: string;
  readonly firstSession: FixtureSession;
  readonly secondSession: FixtureSession;
  readonly server: RunningServer;
  gate(name: string): Gate;
  dispose(): Promise<void>;
}

export interface HarnessOptions {
  readonly script?: ScriptSource;
  /** pi's own settings, written into the hermetic agent directory before the server starts. */
  readonly settings?: unknown;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const home = await createHermeticHome();
  const gates: OwnedGates = createGates(home);
  const secondDirectory = join(home.root, "second-project");
  await mkdir(secondDirectory, { recursive: true });
  const first = await realpath(home.workspace);
  const second = await realpath(secondDirectory);
  const firstSession = await seedSession(home, "plain");
  const secondSession = await seedSession(home, "branching", { project: second });
  if (options.settings !== undefined) {
    await mkdir(home.agentDir, { recursive: true });
    await writeFile(
      join(home.agentDir, "settings.json"),
      `${JSON.stringify(options.settings, null, 2)}\n`,
      "utf8",
    );
  }
  const script = options.script ?? UNUSED_SCRIPT;
  const launch = await scriptedPiLaunch(
    home,
    typeof script === "function" ? script(gates.gate) : script,
  );
  // The hermetic arguments switch skills off, and a reload's whole promise is that startup files are
  // read again, so this Session's children run with the agent directory's skills enabled.
  const args = launch.args.filter((argument) => argument !== "--no-skills");
  const server = await startServer({
    projects: [first, second],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args, env: launch.env, provider: launch.provider, model: launch.model },
  });
  let disposal: Promise<void> | undefined;
  return {
    home,
    first,
    second,
    firstSession,
    secondSession,
    server,
    gate: gates.gate,
    dispose: () => {
      disposal ??= disposeHarnessInOrder(gates, [() => server.close(), () => home.dispose()]);
      return disposal;
    },
  };
}

/**
 * Write the skill into the hermetic agent directory. Called only after the first Commands frame, so
 * the child that answered it has provably never read this file.
 */
export async function writeSkill(harness: Harness): Promise<void> {
  const directory = join(harness.home.agentDir, "skills", SKILL);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${SKILL}\ndescription: Written while the Session was attached.\n---\n\nSay it again.`,
    "utf8",
  );
}

/** The three surfaces an attach sends after its Snapshot, in the order they arrive. */
export async function readSurfaces(client: WsSessionClient): Promise<ServerMessage[]> {
  const surfaces: ServerMessage[] = [];
  while (surfaces.length < 3) {
    const message = await client.next();
    if (
      message.type === "settings" ||
      message.type === "commands" ||
      message.type === "contextUsage"
    ) {
      surfaces.push(message);
    }
  }
  return surfaces;
}

export interface Attachment {
  readonly snapshot: SnapshotMessage;
  readonly surfaces: readonly ServerMessage[];
}

/** Open a Session the way the client does: subscribe, read the Snapshot, then its surfaces. */
export async function attach(client: WsSessionClient, session: SessionRef): Promise<Attachment> {
  client.send({ type: "subscribe", session });
  const snapshot = await client.next();
  if (snapshot.type !== "snapshot") {
    throw new Error(`the subscribe answered with ${snapshot.type}`);
  }
  return { snapshot, surfaces: await readSurfaces(client) };
}

/**
 * Everything a reload sends back, up to its reply. A pushed Session list is a list refresh rather
 * than part of the answer, so it is skipped instead of counted.
 */
export async function reloadFrames(client: WsSessionClient): Promise<ServerMessage[]> {
  const frames: ServerMessage[] = [];
  for (let read = 0; read < 20; read += 1) {
    const message = await client.next();
    if (message.type === "sessions") {
      continue;
    }
    if (message.type === "error") {
      throw new Error(`the reload was refused: ${message.error.message}`);
    }
    frames.push(message);
    if (message.type === "reloaded") {
      return frames;
    }
  }
  throw new Error("the reload answered with no reply");
}

/**
 * The frames up to and including the next one of `type`. A request this server answers after the
 * reload was handled is a fence: everything the reload was going to send has already been written
 * to the socket, so a list of what arrived is a list of all that arrived.
 */
export async function readUntil(
  client: WsSessionClient,
  type: ServerMessage["type"],
): Promise<ServerMessage[]> {
  const frames: ServerMessage[] = [];
  for (let read = 0; read < 40; read += 1) {
    const message = await client.next();
    if (message.type === "sessions") {
      continue;
    }
    frames.push(message);
    if (message.type === type) {
      return frames;
    }
  }
  throw new Error(`the server sent no ${type}`);
}

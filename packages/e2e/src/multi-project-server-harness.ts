/**
 * The server half of a multi-Project harness: one real server over two or three served Projects,
 * its gates, its seeded Sessions. It is kept apart from the page helpers so a backend spec can use
 * it without pulling a browser runner into a suite that never opens a page.
 */

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { ServerMessage } from "@pi-my-ui/protocol";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession, type FixtureSession } from "./fixture-builder";
import { createGates, type Gate, type OwnedGates } from "./gate";
import { disposeHarnessInOrder } from "./harness-teardown";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "./pi-harness";
import type { WsSessionClient } from "./ws-session-client";

/** The marker each seeded Session carries on its own active path. */
export const FIRST_MARKER = "Seed text block 54.";
export const SECOND_MARKER = "Seed text block 32.";

export const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

export const REPLY_SCRIPT: Script = [
  {
    expect: { role: "user", text: "hello there" },
    reply: {
      content: [{ type: "text", text: "reply from the chosen Project" }],
      stopReason: "stop",
    },
  },
];

/**
 * A script, or a builder for one. A script whose command must outlive the browser's check names a
 * gate in the builder, so the test decides when the command returns rather than a fixed sleep.
 */
export type ScriptSource = Script | ((gate: (name: string) => Gate) => Script);

/** What every server harness owns, whatever Projects it serves. */
export interface ServedHarness {
  readonly home: HermeticHome;
  readonly server: RunningServer;
  gate(name: string): Gate;
  /** Gates, then the server, then the home. A harness holding more closes it around this. */
  dispose(): Promise<void>;
}

export interface Harness extends ServedHarness {
  readonly first: string;
  readonly second: string;
  readonly empty: string;
  readonly firstSession: FixtureSession;
  readonly secondSession: FixtureSession;
}

/** Start one server over `projects`, resolving a script builder against the harness's gates. */
async function serve(
  home: HermeticHome,
  projects: readonly string[],
  gates: OwnedGates,
  script: ScriptSource,
): Promise<RunningServer> {
  const resolved = typeof script === "function" ? script(gates.gate) : script;
  const launch = await scriptedPiLaunch(home, resolved);
  return await startServer({
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
}

/** The teardown every harness here shares, so the order is written once. */
function ownedTeardown(
  home: HermeticHome,
  gates: OwnedGates,
  server: RunningServer,
): () => Promise<void> {
  let disposal: Promise<void> | undefined;
  return () => {
    disposal ??= disposeHarnessInOrder(gates, [() => server.close(), () => home.dispose()]);
    return disposal;
  };
}

export async function startHarness(script: ScriptSource = UNUSED_SCRIPT): Promise<Harness> {
  const home = await createHermeticHome();
  const gates = createGates(home);
  const secondDirectory = join(home.root, "second-project");
  const emptyDirectory = join(home.root, "empty-project");
  await mkdir(secondDirectory, { recursive: true });
  await mkdir(emptyDirectory, { recursive: true });
  const first = await realpath(home.workspace);
  const second = await realpath(secondDirectory);
  const empty = await realpath(emptyDirectory);
  // A file only one Project holds, so a panel rooted at the wrong Project is visible as a wrong row.
  await writeFile(join(first, "first-only.txt"), "first project file\n", "utf8");
  await writeFile(join(second, "second-only.txt"), "second project file\n", "utf8");
  const firstSession = await seedSession(home, "plain");
  const secondSession = await seedSession(home, "branching", { project: second });
  const server = await serve(home, [first, second, empty], gates, script);
  return {
    home,
    server,
    first,
    second,
    empty,
    firstSession,
    secondSession,
    gate: gates.gate,
    dispose: ownedTeardown(home, gates, server),
  };
}

/** The next frame of one type; the server also pushes lists and attach surfaces on its own. */
export async function nextFrameOfType<T extends ServerMessage["type"]>(
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

export async function disposeHarness(harness: ServedHarness): Promise<void> {
  await harness.dispose();
}

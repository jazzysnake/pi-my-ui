/**
 * One harness per test: the hermetic home, the served Project, the seeded Sessions, the server and
 * the client page server, plus every gate the test holds. A test starts it once and disposes it
 * once; the factory owns the order, so a spec cannot forget to close a server or strand a gate.
 */

import { relative } from "node:path";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "./client-page-server";
import { seedSession, type FixtureSession, type SeedName } from "./fixture-builder";
import { createGates, type Gate, type OwnedGates } from "./gate";
import { disposeHarnessInOrder } from "./harness-teardown";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "./pi-harness";

export interface HarnessOptions {
  /**
   * Build the script for this test. It runs before the server starts and receives the gate source,
   * so a scripted command can name a gate the test opens later.
   */
  readonly script: (gate: (name: string) => Gate) => Script;
  /** The Sessions to seed into the hermetic workspace, in order. Defaults to one `plain` Session. */
  readonly seeds?: readonly SeedName[];
  readonly piSubagents?: boolean;
}

export interface Harness {
  readonly home: HermeticHome;
  /** The one served Project: the hermetic workspace. */
  readonly project: string;
  readonly sessions: readonly FixtureSession[];
  /** The first seeded Session. */
  readonly session: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
  gate(name: string): Gate;
  dispose(): Promise<void>;
}

const DEFAULT_SEEDS: readonly SeedName[] = ["plain"];

/**
 * A gate is only invisible to the file panel if it lies outside every served Project, so a Project
 * that would contain it fails here rather than in an assertion about a listing.
 */
function refuseProjectAroundGates(gates: OwnedGates, project: string): void {
  const leak = relative(project, gates.root);
  if (leak === "" || !leak.startsWith("..")) {
    throw new Error(`the Project at ${project} would serve this test's gate directory`);
  }
}

export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const home = await createHermeticHome();
  const gates = createGates(home);
  // Collected as each resource comes up, so a failure part-way through closes only what started,
  // in the reverse order of its opening.
  const started: (() => Promise<void>)[] = [() => home.dispose()];

  try {
    const project = home.workspace;
    refuseProjectAroundGates(gates, project);
    const sessions: FixtureSession[] = [];
    for (const seed of options.seeds ?? DEFAULT_SEEDS) {
      sessions.push(await seedSession(home, seed));
    }
    const firstSession = sessions[0];
    if (firstSession === undefined) {
      throw new Error("the harness needs at least one seeded Session");
    }

    const launch = await scriptedPiLaunch(home, options.script(gates.gate), {
      ...(options.piSubagents === undefined ? {} : { piSubagents: options.piSubagents }),
    });
    const ownedServer = await startServer({
      projects: [project],
      sessionDir: home.sessionsDir,
      port: home.ports.allocate(),
      pi: {
        args: launch.args,
        env: launch.env,
        provider: launch.provider,
        model: launch.model,
      },
    });
    started.unshift(() => ownedServer.close());
    const ownedClient = await startClientPageServer();
    started.unshift(() => ownedClient.close());

    let disposal: Promise<void> | undefined;
    return {
      home,
      project,
      sessions,
      session: firstSession,
      server: ownedServer,
      client: ownedClient,
      gate: gates.gate,
      dispose: () => {
        disposal ??= disposeHarnessInOrder(gates, started);
        return disposal;
      },
    };
  } catch (error) {
    await disposeHarnessInOrder(gates, started);
    throw error;
  }
}

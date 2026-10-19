/**
 * One harness per test: the hermetic home, the served Projects, the seeded Sessions, the server and
 * the client page server, plus every gate the test holds. A test starts it once and disposes it
 * once; the factory owns the order, so a spec cannot forget to close a server or strand a gate.
 */

import { mkdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "./client-page-server";
import { seedSession, type FixtureSession, type SeedName } from "./fixture-builder";
import { createGates, type Gate, type Gates } from "./gate";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "./pi-harness";

/** One seeded Session and the Project whose Sessions list should discover it. */
export interface HarnessSeed {
  readonly fixture: SeedName;
  /** Index into `projects`; defaults to the first Project. */
  readonly project?: number;
  /** A distinct id, so two Projects can both hold the same seed shape. */
  readonly id?: string;
  /** A distinct header timestamp, so the two seed files do not collide on disk. */
  readonly timestamp?: string;
}

export interface HarnessOptions {
  /**
   * Build the script for this test. It runs before the server starts and receives the gate source,
   * so a scripted command can name a gate the test opens later.
   */
  readonly script: (gate: (name: string) => Gate) => Script;
  /**
   * The Projects to serve. A relative name is created under the hermetic root; the default is the
   * hermetic workspace, so a single-Project test passes no `projects` at all.
   */
  readonly projects?: readonly string[];
  /** Defaults to one `plain` Session in the first Project. */
  readonly seeds?: readonly HarnessSeed[];
  readonly piSubagents?: boolean;
  readonly modelName?: string;
  readonly extensions?: readonly string[];
}

export interface Harness {
  readonly home: HermeticHome;
  readonly gates: Gates;
  /** Every served Project as an absolute real path, in the order given. */
  readonly projects: readonly string[];
  /** The first served Project. */
  readonly project: string;
  readonly sessions: readonly FixtureSession[];
  /** The first seeded Session. */
  readonly session: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
  gate(name: string): Gate;
  dispose(): Promise<void>;
}

const DEFAULT_SEEDS: readonly HarnessSeed[] = [{ fixture: "plain" }];

async function createProjects(
  home: HermeticHome,
  directories: readonly string[],
): Promise<readonly string[]> {
  const projects: string[] = [];
  for (const directory of directories) {
    const full = join(home.root, directory);
    await mkdir(full, { recursive: true });
    projects.push(await realpath(full));
  }
  return projects;
}

/**
 * A gate is only invisible to the file panel if it lies outside every served Project, so a Project
 * that would contain it fails here rather than in an assertion about a listing.
 */
function refuseProjectsAroundGates(gates: Gates, projects: readonly string[]): void {
  for (const project of projects) {
    const leak = relative(project, gates.root);
    if (leak === "" || !leak.startsWith("..")) {
      throw new Error(`the Project at ${project} would serve this test's gate directory`);
    }
  }
}

async function seedAll(
  home: HermeticHome,
  projects: readonly string[],
  seeds: readonly HarnessSeed[],
): Promise<readonly FixtureSession[]> {
  const sessions: FixtureSession[] = [];
  for (const seed of seeds) {
    const project = projects[seed.project ?? 0];
    if (project === undefined) {
      throw new Error(
        `seed ${seed.fixture} names Project ${String(seed.project ?? 0)}, which is not served`,
      );
    }
    sessions.push(
      await seedSession(home, seed.fixture, {
        project,
        ...(seed.id === undefined ? {} : { id: seed.id }),
        ...(seed.timestamp === undefined ? {} : { timestamp: seed.timestamp }),
      }),
    );
  }
  return sessions;
}

export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const home = await createHermeticHome();
  const gates = createGates(home);
  let server: RunningServer | undefined;
  let client: ClientPageServer | undefined;

  try {
    const projects = await createProjects(home, options.projects ?? [home.workspace]);
    refuseProjectsAroundGates(gates, projects);
    const sessions = await seedAll(home, projects, options.seeds ?? DEFAULT_SEEDS);
    const firstProject = projects[0];
    const firstSession = sessions[0];
    if (firstProject === undefined || firstSession === undefined) {
      throw new Error("the harness needs at least one Project and one seeded Session");
    }

    const launch = await scriptedPiLaunch(home, options.script(gates.gate), {
      ...(options.piSubagents === undefined ? {} : { piSubagents: options.piSubagents }),
      ...(options.modelName === undefined ? {} : { modelName: options.modelName }),
      ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    });
    const ownedServer = await startServer({
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
    server = ownedServer;
    const ownedClient = await startClientPageServer();
    client = ownedClient;

    let disposal: Promise<void> | undefined;
    return {
      home,
      gates,
      projects,
      project: firstProject,
      sessions,
      session: firstSession,
      server: ownedServer,
      client: ownedClient,
      gate: gates.gate,
      dispose: () => {
        // Gates first: an unreleased gate holds a Pi child until the command's own bound, so
        // teardown after a failed assertion must not wait on a run the test stopped caring about.
        disposal ??= (async () => {
          await gates.releaseAll();
          await ownedClient.close();
          await ownedServer.close();
          await home.dispose();
        })();
        return disposal;
      },
    };
  } catch (error) {
    await gates.releaseAll();
    await client?.close();
    await server?.close();
    await home.dispose();
    throw error;
  }
}

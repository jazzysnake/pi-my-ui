import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  RpcClient,
  getPackageDir,
  type JsonAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import {
  MODEL_NAME_ENV_VAR,
  SCRIPT_ENV_VAR,
  SCRIPTED_MODEL_ID,
  SCRIPTED_PROVIDER_ID,
  type Script,
} from "@pi-my-ui/scripted-provider";
import { HERMETIC_PI_ARGS } from "@pi-my-ui/scripted-provider/record";

const PORT_NAMESPACE_SIZE = 16;
const DEFAULT_PROMPT_TIMEOUT_MS = 60_000;

/**
 * The built scripted-provider extension. It is resolved from the source tree rather than the package
 * entry so a run that never built the workspace fails with the path to build, not a module error.
 */
const SCRIPTED_PROVIDER_EXTENSION = fileURLToPath(
  new URL("../../scripted-provider/dist/index.js", import.meta.url),
);

/**
 * The workspace-pinned pi-subagents extension, loaded the way a real session has it. Tests that need
 * the subagent surface opt in; every other spec runs without it, which is also the state of a user
 * who has not installed the extension.
 */
export const PI_SUBAGENTS_EXTENSION = createRequire(import.meta.url).resolve(
  "@tintinweb/pi-subagents/dist/index.js",
);

/**
 * A contiguous block of ports owned by one test.
 *
 * The base comes from the OS, so parallel workers get disjoint blocks without a shared registry, and
 * a single test can hand out several ports without probing for each one.
 */
export interface PortNamespace {
  allocate(): number;
}

async function probeFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

export async function createPortNamespace(size = PORT_NAMESPACE_SIZE): Promise<PortNamespace> {
  const base = await probeFreePort();
  if (base + size > 65_535) {
    return createPortNamespace(size);
  }
  let used = 0;
  return {
    allocate() {
      if (used >= size) {
        throw new Error(`port namespace exhausted after ${String(size)} ports`);
      }
      const port = base + used;
      used += 1;
      return port;
    },
  };
}

/** Everything one test owns: a temp tree, a hermetic pi home, a workspace and a port block. */
export interface HermeticHome {
  readonly root: string;
  readonly home: string;
  readonly agentDir: string;
  readonly sessionsDir: string;
  readonly workspace: string;
  readonly ports: PortNamespace;
  dispose(): Promise<void>;
}

export async function createHermeticHome(): Promise<HermeticHome> {
  const root = await mkdtemp(join(tmpdir(), "pi-my-ui-e2e-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const agentDir = join(home, ".pi", "agent");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  return {
    root,
    home,
    agentDir,
    sessionsDir: join(agentDir, "sessions"),
    workspace,
    ports: await createPortNamespace(),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * The private environment every hermetic pi child gets. `extra` carries the credentials a test
 * deliberately passes through; nothing from the developer's own environment leaks in by default.
 */
export function hermeticPiEnv(
  home: HermeticHome,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    HOME: home.home,
    XDG_CONFIG_HOME: join(home.home, ".config"),
    XDG_DATA_HOME: join(home.home, ".local", "share"),
    XDG_CACHE_HOME: join(home.home, ".cache"),
    XDG_STATE_HOME: join(home.home, ".local", "state"),
    // Set explicitly so pi cannot fall back to the developer's own agent directory.
    PI_CODING_AGENT_DIR: home.agentDir,
    PI_CODING_AGENT_SESSION_DIR: home.sessionsDir,
    ...extra,
  };
}

function hermeticEnv(
  home: HermeticHome,
  scriptPath: string,
  modelName: string | undefined,
): Record<string, string> {
  const scriptEnv = { [SCRIPT_ENV_VAR]: scriptPath };
  return hermeticPiEnv(
    home,
    modelName === undefined ? scriptEnv : { ...scriptEnv, [MODEL_NAME_ENV_VAR]: modelName },
  );
}

export interface PiTurn {
  /** Every RPC event pi emitted between the prompt and settling. */
  readonly events: readonly JsonAgentSessionEvent[];
  /** Assistant turns with a terminal success, in order. */
  readonly replies: readonly AssistantMessage[];
  /** The error text when pi's last assistant turn failed; `undefined` on a clean turn. */
  readonly error: string | undefined;
}

/** A run that ended with a failed assistant turn, so a test cannot mistake it for a reply. */
export class ScriptedPiError extends Error {
  constructor(
    message: string,
    readonly turn: PiTurn,
  ) {
    super(message);
    this.name = "ScriptedPiError";
  }
}

export interface ScriptedPi {
  readonly home: HermeticHome;
  readonly child: RpcClient;
  prompt(text: string, timeoutMs?: number): Promise<PiTurn>;
  stop(): Promise<void>;
}

function summarize(events: readonly JsonAgentSessionEvent[]): PiTurn {
  const replies: AssistantMessage[] = [];
  let error: string | undefined;
  for (const event of events) {
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      continue;
    }
    const message = event.message as AssistantMessage;
    if (message.stopReason === "error") {
      error = message.errorMessage ?? "the assistant turn failed without an error message";
    } else {
      replies.push(message);
    }
  }
  return { events, replies, error };
}

export interface StartScriptedPiOptions {
  readonly home: HermeticHome;
  readonly script: Script;
  /** Keep a Session file in the hermetic home; tests that inspect Sessions leave this on. */
  readonly session?: boolean;
  /** Load pi-subagents as a real session has it; a test proving its absence turns this off. */
  readonly piSubagents?: boolean;
  /** Further pi extensions to load beside the scripted provider. */
  readonly extensions?: readonly string[];
  /** The name pi reports for its model; a test that measures a long label sets one. */
  readonly modelName?: string;
}

/** The extension options a hermetic launch accepts. */
export interface ScriptedLaunchOptions {
  readonly piSubagents?: boolean;
  readonly extensions?: readonly string[];
  readonly modelName?: string;
}

/** What a hermetic pi child needs: its workspace, its private environment, and its model. */
export interface ScriptedPiLaunch {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly args: readonly string[];
  readonly provider: string;
  readonly model: string;
}

/**
 * Write `script` into `home` and describe the pi child that would replay it. Split from
 * {@link startScriptedPi} so a test that runs pi itself (the server under test owns the children it
 * spawns) launches them hermetically the same way.
 */
export async function scriptedPiLaunch(
  home: HermeticHome,
  script: Script,
  options: ScriptedLaunchOptions = {},
): Promise<ScriptedPiLaunch> {
  await mkdir(home.sessionsDir, { recursive: true });
  const scriptPath = join(home.root, "script.json");
  await writeFile(scriptPath, `${JSON.stringify(script, null, 2)}\n`, "utf8");
  const installed = options.piSubagents === false ? [] : [PI_SUBAGENTS_EXTENSION];
  const extra = [...installed, ...(options.extensions ?? [])].flatMap((entry) => [
    "--extension",
    entry,
  ]);
  return {
    cwd: home.workspace,
    env: hermeticEnv(home, scriptPath, options.modelName),
    args: [...HERMETIC_PI_ARGS, "--extension", SCRIPTED_PROVIDER_EXTENSION, ...extra],
    provider: SCRIPTED_PROVIDER_ID,
    model: SCRIPTED_MODEL_ID,
  };
}

/**
 * Start a real `pi --mode rpc` child that answers model calls from `script`.
 *
 * Pi is the workspace-pinned binary (`getPackageDir`), never whatever `pi` is on PATH, so the suite
 * runs the version the repo pins.
 */
export async function startScriptedPi(options: StartScriptedPiOptions): Promise<ScriptedPi> {
  if (!existsSync(SCRIPTED_PROVIDER_EXTENSION)) {
    throw new Error(
      `the scripted provider is not built at ${SCRIPTED_PROVIDER_EXTENSION}; run npm run build`,
    );
  }

  const { home } = options;
  const launch = await scriptedPiLaunch(home, options.script, {
    ...(options.piSubagents === undefined ? {} : { piSubagents: options.piSubagents }),
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(options.modelName === undefined ? {} : { modelName: options.modelName }),
  });
  const args = [...launch.args];
  if (options.session === false) {
    args.push("--no-session");
  }

  const child = new RpcClient({
    cliPath: join(getPackageDir(), "dist", "cli.js"),
    cwd: launch.cwd,
    env: launch.env,
    provider: launch.provider,
    model: launch.model,
    args,
  });
  await child.start();

  return {
    home,
    child,
    async prompt(text, timeoutMs = DEFAULT_PROMPT_TIMEOUT_MS) {
      const turn = summarize(await child.promptAndWait(text, undefined, timeoutMs));
      // A failed turn is never a reply: surface it here so an unexpected prompt fails the test that
      // asked, not the next assertion that happened to look at empty output.
      if (turn.error !== undefined) {
        throw new ScriptedPiError(turn.error, turn);
      }
      return turn;
    },
    stop: () => child.stop(),
  };
}

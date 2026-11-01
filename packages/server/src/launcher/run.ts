/**
 * The launcher's run sequence: parse, validate, start the server, print where it listens, then shut
 * down cleanly on SIGINT/SIGTERM.
 *
 * Shutdown stops accepting connections and closes the Session pool, which stops every Pi child the
 * server started, so a clean exit leaves no orphan `pi` processes. Output goes to injected streams
 * so the sequence can be driven in-process while the entry point stays a thin shell.
 */

import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_HOST, type ServerConfig } from "../config.js";
import { isLoopbackHostname } from "../loopback.js";
import { parseLauncherArgs, type LauncherArguments } from "./args.js";
import { launcherBindError } from "./bind.js";
import { errorText } from "../error-text.js";
import { LauncherArgumentError, LauncherConfigurationError } from "./errors.js";
import { FLAG, LAUNCHER_USAGE, SHUTDOWN_SIGNALS, flagLabel, type ShutdownSignal } from "./flags.js";
import { ServerBindError, startServer, type RunningServer } from "../server.js";

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE_FAILURE = 2;

const MS_PER_SECOND = 1_000;

export const LOG_PREFIX = "pi-my-ui:";

/** A validated launcher configuration. */
export interface LauncherConfig {
  /** Absolute and `realpath`-resolved; defaults to `processCwd`, and registers nothing by itself. */
  readonly workspace: string;
  /** Absolute and `realpath`-resolved, in the order the flags were given. */
  readonly projects: readonly string[];
  readonly host: string;
  readonly port: number;
  readonly idleTimeoutSeconds: number;
  readonly keepAlive: boolean;
  readonly allowedOrigins: readonly string[];
}

export interface LauncherIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The signal registration the launcher needs; `process` satisfies it. */
export interface LauncherSignals {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface LauncherHooks {
  /** Overridable so a test can start the real server with a hermetic Pi launch. */
  readonly startServer?: ((config: ServerConfig) => Promise<RunningServer>) | undefined;
  readonly signals?: LauncherSignals | undefined;
  readonly io?: LauncherIo | undefined;
}

export interface RunLauncherOptions extends LauncherHooks {
  readonly argv: readonly string[];
  /** The directory a relative `--project` or `--workspace` resolves against: the process's own. */
  readonly processCwd: string;
}

function processIo(): LauncherIo {
  return {
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };
}

function directoryError(flagName: string, detail: string): LauncherConfigurationError {
  return new LauncherConfigurationError(flagLabel(flagName), `${flagLabel(flagName)} ${detail}`);
}

/** `realpath` a directory flag, then refuse anything a Pi child could not run in. */
function resolveDirectory(flagName: string, processCwd: string, given: string): string {
  const absolute = resolve(processCwd, given);
  let resolved: string;
  try {
    resolved = realpathSync(absolute);
  } catch (error) {
    throw directoryError(
      flagName,
      `is not a readable directory: ${absolute} (${errorText(error)})`,
    );
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(resolved).isDirectory();
    accessSync(resolved, constants.R_OK);
  } catch (error) {
    throw directoryError(
      flagName,
      `is not a readable directory: ${resolved} (${errorText(error)})`,
    );
  }
  if (!isDirectory) {
    throw directoryError(flagName, `must be a directory, but ${resolved} is not`);
  }
  return resolved;
}

/**
 * Resolve every `--project`, refusing only a list that names one directory twice. Projects may
 * nest, because discovery finds nested repositories by construction. The order the owner typed is
 * kept, because that is the order the picker shows.
 */
function resolveProjects(processCwd: string, given: readonly string[]): readonly string[] {
  const resolved = given.map((entry) => resolveDirectory(FLAG.project, processCwd, entry));
  const seen = new Set<string>();
  for (const project of resolved) {
    if (seen.has(project)) {
      throw directoryError(FLAG.project, `names the same Project twice: ${project}`);
    }
    seen.add(project);
  }
  return resolved;
}

/** Resolve the served Projects, then apply the exposure rule: beyond loopback needs an allowlist. */
export function resolveLauncherConfig(
  values: LauncherArguments,
  processCwd: string,
): LauncherConfig {
  // The working directory is an anchor, never a served Project: running in a repository serves it
  // only because discovery finds `.git` there.
  const workspace = resolveDirectory(FLAG.workspace, processCwd, values.workspace ?? ".");
  const projects = resolveProjects(processCwd, values.projects);

  if (values.host.trim().length === 0) {
    // An empty `--host` reaches `listen(port, "")`, which binds every interface; refuse rather than
    // silently widen exposure.
    throw new LauncherConfigurationError(
      flagLabel(FLAG.host),
      `${flagLabel(FLAG.host)} must not be blank; pass a real address such as ${DEFAULT_HOST}`,
    );
  }

  if (!isLoopbackHostname(values.host) && values.allowedOrigins.length === 0) {
    throw new LauncherConfigurationError(
      flagLabel(FLAG.allowedOrigin),
      `refusing to bind to ${values.host}: binding beyond loopback requires at least one ` +
        `${flagLabel(FLAG.allowedOrigin)}`,
    );
  }

  return {
    workspace,
    projects,
    host: values.host,
    port: values.port,
    idleTimeoutSeconds: values.idleTimeoutSeconds,
    keepAlive: values.keepAlive,
    allowedOrigins: values.allowedOrigins,
  };
}

function toServerConfig(config: LauncherConfig): ServerConfig {
  return {
    projects: config.projects,
    workspace: config.workspace,
    host: config.host,
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    idleTimeoutMs: config.idleTimeoutSeconds * MS_PER_SECOND,
    keepAlive: config.keepAlive,
  };
}

interface PendingSignal {
  readonly promise: Promise<ShutdownSignal>;
  dispose(): void;
}

function watchShutdownSignals(signals: LauncherSignals): PendingSignal {
  let resolveReceived: ((signal: ShutdownSignal) => void) | undefined;
  const promise = new Promise<ShutdownSignal>((resolve) => {
    resolveReceived = resolve;
  });
  const listeners: (readonly [ShutdownSignal, () => void])[] = [];
  let received: ShutdownSignal | undefined;

  for (const signal of SHUTDOWN_SIGNALS) {
    const listener = (): void => {
      if (received !== undefined) {
        return;
      }
      received = signal;
      resolveReceived?.(signal);
    };
    listeners.push([signal, listener]);
    signals.on(signal, listener);
  }

  return {
    promise,
    dispose(): void {
      for (const [signal, listener] of listeners) {
        signals.off(signal, listener);
      }
    },
  };
}

function exitCodeFor(error: unknown): number {
  return error instanceof LauncherArgumentError ? EXIT_USAGE_FAILURE : EXIT_FAILURE;
}

/** Run to completion, returning the process exit code. User errors are printed, not thrown. */
export async function runLauncher(options: RunLauncherOptions): Promise<number> {
  const io = options.io ?? processIo();
  try {
    const parsed = parseLauncherArgs(options.argv);
    if (parsed.kind === "help") {
      io.out(LAUNCHER_USAGE);
      return EXIT_OK;
    }

    const config = resolveLauncherConfig(parsed.values, options.processCwd);
    const start = options.startServer ?? startServer;
    const signals = options.signals ?? process;
    const pending = watchShutdownSignals(signals);

    let server: RunningServer;
    try {
      server = await start(toServerConfig(config));
    } catch (error) {
      pending.dispose();
      throw error instanceof ServerBindError ? launcherBindError(error) : error;
    }

    io.out(`${LOG_PREFIX} workspace ${config.workspace}`);
    for (const project of config.projects) {
      io.out(`${LOG_PREFIX} project ${project}`);
    }
    io.out(`${LOG_PREFIX} listening on ${server.httpUrl}`);

    const signal = await pending.promise;
    pending.dispose();
    io.out(`${LOG_PREFIX} ${signal} received, shutting down`);
    await server.close();
    return EXIT_OK;
  } catch (error) {
    io.err(errorText(error));
    return exitCodeFor(error);
  }
}

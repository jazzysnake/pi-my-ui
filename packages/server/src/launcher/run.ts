/**
 * The launcher's run sequence: parse, validate, start the server, print where it listens, then shut
 * down cleanly on SIGINT/SIGTERM.
 *
 * Shutdown stops accepting connections and closes the Session pool, which stops every Pi child the
 * server started, so a clean exit leaves no orphan `pi` processes. Output goes to injected streams
 * so the sequence can be driven in-process while the entry point stays a thin shell.
 */

import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

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
  /** The directory a relative `--project` resolves against, which is the process's own. */
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

function projectError(detail: string): LauncherConfigurationError {
  return new LauncherConfigurationError(
    flagLabel(FLAG.project),
    `${flagLabel(FLAG.project)} ${detail}`,
  );
}

/** `realpath` one `--project`, then refuse anything a Pi child could not run in. */
function resolveProject(processCwd: string, given: string): string {
  const absolute = resolve(processCwd, given);
  let resolved: string;
  try {
    resolved = realpathSync(absolute);
  } catch (error) {
    throw projectError(`is not a readable directory: ${absolute} (${errorText(error)})`);
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(resolved).isDirectory();
    accessSync(resolved, constants.R_OK);
  } catch (error) {
    throw projectError(`is not a readable directory: ${resolved} (${errorText(error)})`);
  }
  if (!isDirectory) {
    throw projectError(`must be a directory, but ${resolved} is not`);
  }
  return resolved;
}

/** Whether `child` sits anywhere below `parent`, so both cannot be served as separate roots. */
function contains(parent: string, child: string): boolean {
  const below = relative(parent, child);
  return below !== "" && !below.startsWith("..") && !isAbsolute(below);
}

/**
 * Resolve every `--project` and refuse a list that cannot describe distinct roots. The order the
 * owner typed is kept, because that is the order the picker shows.
 */
function resolveProjects(processCwd: string, given: readonly string[]): readonly string[] {
  const resolved = (given.length === 0 ? ["."] : given).map((entry) =>
    resolveProject(processCwd, entry),
  );
  const seen = new Set<string>();
  for (const project of resolved) {
    if (seen.has(project)) {
      throw projectError(`names the same Project twice: ${project}`);
    }
    seen.add(project);
  }
  for (const [index, project] of resolved.entries()) {
    const enclosing = resolved.find(
      (other, otherIndex) => otherIndex !== index && contains(other, project),
    );
    if (enclosing !== undefined) {
      throw projectError(
        `serves ${project}, which is inside the served Project ${enclosing}; Projects may not nest`,
      );
    }
  }
  return resolved;
}

/** Resolve the served Projects, then apply the exposure rule: beyond loopback needs an allowlist. */
export function resolveLauncherConfig(
  values: LauncherArguments,
  processCwd: string,
): LauncherConfig {
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

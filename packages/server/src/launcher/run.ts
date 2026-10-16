/**
 * The launcher's run sequence: parse, validate, start the server, print where it listens, then shut
 * down cleanly on SIGINT/SIGTERM.
 *
 * Shutdown stops accepting connections and closes the Session pool, which stops every Pi child the
 * server started, so a clean exit leaves no orphan `pi` processes. Output goes to injected streams
 * so the sequence can be driven in-process while the entry point stays a thin shell.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";

import type { ServerConfig } from "../config.js";
import { isLoopbackHostname } from "../loopback.js";
import { parseLauncherArgs, type LauncherArguments } from "./args.js";
import { launcherBindError } from "./bind.js";
import { LauncherArgumentError, LauncherConfigurationError, errorText } from "./errors.js";
import {
  DEFAULT_LAUNCH_HOST,
  FLAG,
  LAUNCHER_USAGE,
  SHUTDOWN_SIGNALS,
  flagLabel,
  type ShutdownSignal,
} from "./flags.js";
import { ServerBindError, startServer, type RunningServer } from "../server.js";

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE_FAILURE = 2;

const MS_PER_SECOND = 1_000;

export const LOG_PREFIX = "pi-my-ui:";

/** A validated launcher configuration. */
export interface LauncherConfig {
  readonly cwd: string;
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
  readonly cwd: string;
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

/** Resolve `--cwd`, then apply the exposure rule: beyond loopback needs an allowlist. */
export function resolveLauncherConfig(
  values: LauncherArguments,
  processCwd: string,
): LauncherConfig {
  const cwd = resolve(processCwd, values.cwd ?? ".");
  let isDirectory: boolean;
  try {
    isDirectory = statSync(cwd).isDirectory();
  } catch (error) {
    throw new LauncherConfigurationError(
      flagLabel(FLAG.cwd),
      `${flagLabel(FLAG.cwd)} is not a readable directory: ${cwd} (${errorText(error)})`,
    );
  }
  if (!isDirectory) {
    throw new LauncherConfigurationError(
      flagLabel(FLAG.cwd),
      `${flagLabel(FLAG.cwd)} must be a directory, but ${cwd} is not`,
    );
  }

  if (values.host.trim().length === 0) {
    // An empty `--host` reaches `listen(port, "")`, which binds every interface; refuse rather than
    // silently widen exposure.
    throw new LauncherConfigurationError(
      flagLabel(FLAG.host),
      `${flagLabel(FLAG.host)} must not be blank; pass a real address such as ${DEFAULT_LAUNCH_HOST}`,
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
    cwd,
    host: values.host,
    port: values.port,
    idleTimeoutSeconds: values.idleTimeoutSeconds,
    keepAlive: values.keepAlive,
    allowedOrigins: values.allowedOrigins,
  };
}

function toServerConfig(config: LauncherConfig): ServerConfig {
  return {
    cwd: config.cwd,
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

    const config = resolveLauncherConfig(parsed.values, options.cwd);
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

    io.out(`${LOG_PREFIX} cwd ${config.cwd}`);
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

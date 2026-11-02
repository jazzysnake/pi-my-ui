/**
 * The `pi-my-ui` launcher's flag surface, defined once. The flag name, its `--help` line, and the
 * parser configuration all come from {@link FLAG_SPECS}, so what is documented and what is parsed
 * cannot drift.
 */

import { ALLOWED_ORIGIN_FLAG_NAME } from "../origin.js";
import { DEFAULT_HOST, DEFAULT_IDLE_TIMEOUT_SECONDS, DEFAULT_PORT } from "../config.js";

/** The executable name as the user types it, used in help and error messages. */
export const LAUNCHER_COMMAND_NAME = "pi-my-ui";

/** Every signal that starts the graceful shutdown sequence. */
export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

/** Flag names without their dashes, used as parser keys and lookup keys. */
export const FLAG = {
  workspace: "workspace",
  project: "project",
  port: "port",
  host: "host",
  idleTimeout: "idle-timeout",
  keepAlive: "keep-alive",
  allowedOrigin: ALLOWED_ORIGIN_FLAG_NAME,
  help: "help",
} as const;

/** `--<name>`; the one place a flag is rendered for a human. */
export function flagLabel(name: string): string {
  return `--${name}`;
}

interface FlagSpec {
  readonly type: "boolean" | "string";
  readonly placeholder: string;
  readonly multiple: boolean;
  readonly short?: string;
  readonly summary: string;
}

/** The whole flag surface. Handed to `parseArgs` and rendered into {@link LAUNCHER_USAGE}. */
export const FLAG_SPECS: Readonly<Record<string, FlagSpec>> = {
  [FLAG.workspace]: {
    type: "string",
    placeholder: "<dir>",
    multiple: false,
    summary: "Directory where Projects are discovered and created (default: the current directory)",
  },
  [FLAG.project]: {
    type: "string",
    placeholder: "<dir>",
    multiple: true,
    summary: "Project directory to serve (repeatable)",
  },
  [FLAG.port]: {
    type: "string",
    placeholder: "<port>",
    multiple: false,
    summary: `TCP port to listen on (default: ${String(DEFAULT_PORT)})`,
  },
  [FLAG.host]: {
    type: "string",
    placeholder: "<address>",
    multiple: false,
    summary: `Address to bind (default: ${DEFAULT_HOST}); beyond loopback requires ${flagLabel(
      FLAG.allowedOrigin,
    )}`,
  },
  [FLAG.idleTimeout]: {
    type: "string",
    placeholder: "<seconds>",
    multiple: false,
    summary: `Evict an idle, unwatched Session after this many seconds (default: ${String(
      DEFAULT_IDLE_TIMEOUT_SECONDS,
    )})`,
  },
  [FLAG.keepAlive]: {
    type: "boolean",
    placeholder: "",
    multiple: false,
    summary: "Disable idle eviction entirely",
  },
  [FLAG.allowedOrigin]: {
    type: "string",
    placeholder: "<origin>",
    multiple: true,
    summary: "Browser origin allowed to connect (scheme://host[:port]; repeatable)",
  },
  [FLAG.help]: {
    type: "boolean",
    placeholder: "",
    multiple: false,
    short: "h",
    summary: "Print this help and exit",
  },
};

const HELP_DESCRIPTION_COLUMN = 44;

function renderUsage(): string {
  const rows = Object.entries(FLAG_SPECS).map(([name, spec]) => {
    const label = spec.short === undefined ? flagLabel(name) : `-${spec.short}, ${flagLabel(name)}`;
    const invocation = spec.placeholder === "" ? label : `${label} ${spec.placeholder}`;
    return `  ${invocation.padEnd(HELP_DESCRIPTION_COLUMN)}${spec.summary}`;
  });

  return [
    `${LAUNCHER_COMMAND_NAME}: one server serving one or more Projects`,
    "",
    `Usage: ${LAUNCHER_COMMAND_NAME} [options]`,
    "",
    "Options:",
    ...rows,
  ].join("\n");
}

/** The exact text `--help` prints; also appended to an argument error. */
export const LAUNCHER_USAGE = renderUsage();

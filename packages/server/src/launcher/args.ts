/**
 * Argument parsing for the launcher. `node:util`'s `parseArgs` tokenises; every value is validated
 * here so an unusable value is an error naming its flag, never a silent default.
 */

import { parseArgs } from "node:util";

import { DEFAULT_IDLE_TIMEOUT_SECONDS } from "../config.js";
import { allowedOriginError, validateAllowedOrigin } from "../origin.js";
import { LauncherArgumentError } from "./errors.js";
import {
  DEFAULT_LAUNCH_HOST,
  DEFAULT_LAUNCH_PORT,
  FLAG,
  FLAG_SPECS,
  LAUNCHER_COMMAND_NAME,
  flagLabel,
} from "./flags.js";

export const MIN_TCP_PORT = 0;
export const MAX_TCP_PORT = 65_535;
/** An idle timeout of 0 would evict immediately, which is never a usable configuration. */
export const MIN_IDLE_TIMEOUT_SECONDS = 1;

/** The flags as parsed, with every default applied. */
export interface LauncherArguments {
  readonly cwd: string | undefined;
  readonly host: string;
  readonly port: number;
  readonly idleTimeoutSeconds: number;
  readonly keepAlive: boolean;
  readonly allowedOrigins: readonly string[];
}

export type ParsedLauncherArgs =
  { readonly kind: "help" } | { readonly kind: "launch"; readonly values: LauncherArguments };

const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

function argumentError(argument: string, detail: string): LauncherArgumentError {
  return new LauncherArgumentError(argument, `${LAUNCHER_COMMAND_NAME}: ${detail}`);
}

function readString(values: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = values[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw argumentError(
      flagLabel(name),
      `${flagLabel(name)} requires a value (${flagLabel(name)} <value>)`,
    );
  }
  return value;
}

function readStringList(
  values: Readonly<Record<string, unknown>>,
  name: string,
): readonly string[] {
  const value = values[name];
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }
  throw argumentError(flagLabel(name), `${flagLabel(name)} requires a value`);
}

function parseBoundedInteger(
  name: string,
  value: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = UNSIGNED_INTEGER_PATTERN.test(value) ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw argumentError(
      flagLabel(name),
      `${flagLabel(name)} must be an integer between ${String(minimum)} and ${String(maximum)}, got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function normaliseAllowedOrigin(value: string): string {
  const validation = validateAllowedOrigin(value);
  if (!validation.ok) {
    throw argumentError(
      flagLabel(FLAG.allowedOrigin),
      allowedOriginError(value, validation.rejection),
    );
  }
  return validation.origin;
}

type ParsedToken =
  | { readonly kind: "option"; readonly name: string; readonly value: string | undefined }
  | { readonly kind: "positional"; readonly value: string }
  | { readonly kind: "option-terminator" };

export function parseLauncherArgs(argv: readonly string[]): ParsedLauncherArgs {
  const values = parseArgs({
    args: [...argv],
    options: FLAG_SPECS,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  if (values.values[FLAG.help] === true) {
    return { kind: "help" };
  }

  for (const token of values.tokens as readonly ParsedToken[]) {
    if (token.kind === "positional") {
      throw argumentError(
        token.value,
        `unexpected positional argument ${JSON.stringify(token.value)}; pass flags only`,
      );
    }
    if (token.kind === "option" && !Object.hasOwn(FLAG_SPECS, token.name)) {
      throw argumentError(flagLabel(token.name), `unknown flag ${flagLabel(token.name)}`);
    }
  }

  const parsedValues = values.values;
  const portValue = readString(parsedValues, FLAG.port);
  const idleTimeoutValue = readString(parsedValues, FLAG.idleTimeout);

  return {
    kind: "launch",
    values: {
      cwd: readString(parsedValues, FLAG.cwd),
      host: readString(parsedValues, FLAG.host) ?? DEFAULT_LAUNCH_HOST,
      port:
        portValue === undefined
          ? DEFAULT_LAUNCH_PORT
          : parseBoundedInteger(FLAG.port, portValue, MIN_TCP_PORT, MAX_TCP_PORT),
      idleTimeoutSeconds:
        idleTimeoutValue === undefined
          ? DEFAULT_IDLE_TIMEOUT_SECONDS
          : parseBoundedInteger(
              FLAG.idleTimeout,
              idleTimeoutValue,
              MIN_IDLE_TIMEOUT_SECONDS,
              Number.MAX_SAFE_INTEGER,
            ),
      keepAlive: parsedValues[FLAG.keepAlive] === true,
      allowedOrigins: readStringList(parsedValues, FLAG.allowedOrigin).map(normaliseAllowedOrigin),
    },
  };
}

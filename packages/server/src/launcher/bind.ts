/** Map a failed bind to the launcher error that names the flag to change. */

import type { ServerBindError } from "../server.js";
import { LauncherBindError } from "./errors.js";
import { FLAG, flagLabel } from "./flags.js";

/** errno codes meaning "this port cannot be used": the fix is another `--port`. */
const PORT_BIND_ERROR_CODES: Readonly<Record<string, true>> = {
  EADDRINUSE: true,
  EACCES: true,
  EPERM: true,
};

const BIND_ERROR_REASONS: Readonly<Record<string, string>> = {
  EADDRINUSE: "the port is already in use",
  EACCES: "permission denied; is the port privileged?",
  EPERM: "permission denied",
  ENOTFOUND: "the host did not resolve to an address",
  EADDRNOTAVAIL: "the host is not an address of this machine",
  EAI_AGAIN: "the host could not be resolved (DNS is temporarily unavailable)",
  EAI_FAIL: "the host could not be resolved",
  EAI_NONAME: "the host name is unknown",
};

const GENERIC_BIND_REASON = "the address could not be bound";

export function launcherBindError(error: ServerBindError): LauncherBindError {
  const setting =
    PORT_BIND_ERROR_CODES[error.code] === true ? flagLabel(FLAG.port) : flagLabel(FLAG.host);
  return new LauncherBindError(
    setting,
    error.code,
    error.hostname,
    error.port,
    BIND_ERROR_REASONS[error.code] ?? GENERIC_BIND_REASON,
    { cause: error },
  );
}

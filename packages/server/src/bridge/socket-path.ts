/**
 * The bridge socket's default path: `$XDG_RUNTIME_DIR/pi-my-ui-<port>/bridge.sock`. The bound port
 * is part of the name, so two servers on one machine cannot share a socket.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

export const BRIDGE_SOCKET_FILENAME = "bridge.sock";
export const BRIDGE_RUNTIME_DIR_PREFIX = "pi-my-ui-";
export const XDG_RUNTIME_DIR = "XDG_RUNTIME_DIR";

/** The per-run socket path for the bound port. */
export function bridgeSocketPath(
  port: number,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const runtimeDir = env[XDG_RUNTIME_DIR];
  const parent = runtimeDir === undefined || runtimeDir === "" ? tmpdir() : runtimeDir;
  return join(parent, `${BRIDGE_RUNTIME_DIR_PREFIX}${String(port)}`, BRIDGE_SOCKET_FILENAME);
}

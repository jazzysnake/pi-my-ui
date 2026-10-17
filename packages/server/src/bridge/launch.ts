/**
 * Loading the bridge extension into every Pi child.
 *
 * The server injects the compiled extension with pi's own `--extension` flag and names the socket in
 * the child's environment, so a child cannot start without the bridge being offered to it. A
 * resolution that fails is a configuration error, not a Session that runs without a bridge.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BRIDGE_SOCKET_ENV_VAR } from "@pi-my-ui/protocol";

import type { PiLaunchOptions } from "../config.js";
import { BridgeConfigurationError, errorText } from "./errors.js";

/** The workspace package whose compiled entry pi loads. */
export const BRIDGE_EXTENSION_SPECIFIER = "@pi-my-ui/bridge-extension";

/** Where the bridge lives for one server: the socket it owns and the extension it loads. */
export interface BridgeLaunchTarget {
  readonly socketPath: string;
  /** Explicit compiled entry; defaults to resolving the workspace package. */
  readonly extensionEntry?: string | undefined;
}

/** The compiled extension path, or a loud failure naming what to build. */
export function resolveBridgeExtensionEntry(override: string | undefined): string {
  const entry = override ?? resolveSpecifier();
  if (entry.trim() === "") {
    throw new BridgeConfigurationError("the bridge extension entry is blank");
  }
  if (!existsSync(entry)) {
    throw new BridgeConfigurationError(
      `the bridge extension is not built at ${entry}; run npm run build`,
    );
  }
  return entry;
}

function resolveSpecifier(): string {
  try {
    return fileURLToPath(import.meta.resolve(BRIDGE_EXTENSION_SPECIFIER));
  } catch (error) {
    throw new BridgeConfigurationError(
      `could not resolve ${BRIDGE_EXTENSION_SPECIFIER}: ${errorText(error)}; run npm run build`,
    );
  }
}

/** `launch` with the bridge extension appended and the socket named in the child's environment. */
export function withBridgeLaunch<T extends PiLaunchOptions>(
  launch: T,
  bridge: BridgeLaunchTarget,
): T {
  const entry = resolveBridgeExtensionEntry(bridge.extensionEntry);
  return {
    ...launch,
    args: [...(launch.args ?? []), "--extension", entry],
    env: { ...(launch.env ?? {}), [BRIDGE_SOCKET_ENV_VAR]: bridge.socketPath },
  };
}

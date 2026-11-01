/** What a running server is told once, at start. Tests override the paths and the pi launch. */

import type { ServerClock } from "./clock.js";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
/** Idle window for an unwatched Session; `docs/adr/0007-idle-window-and-pool-footprint.md` has the numbers. */
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;
export const DEFAULT_IDLE_TIMEOUT_MS = DEFAULT_IDLE_TIMEOUT_SECONDS * 1_000;

/** How the server launches the Pi children it owns. */
export interface PiLaunchOptions {
  readonly cliPath?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

/** Overrides for the required bridge; every default is derived from the bound port. */
export interface BridgeOptions {
  readonly socketPath?: string | undefined;
  readonly extensionEntry?: string | undefined;
  readonly connectTimeoutMs?: number | undefined;
}

export interface ServerConfig {
  /**
   * The Projects the server serves, already resolved to absolute paths and validated by the
   * launcher, in the order they were given. Nothing adds to or reorders this once the server runs.
   */
  readonly projects: readonly string[];
  /**
   * The directory the server is anchored to: where Projects are discovered and created. Optional so
   * a server can be started without one, as every spec that names its Projects does.
   */
  readonly workspace?: string | undefined;
  readonly sessionDir?: string | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly pi?: PiLaunchOptions | undefined;
  /** The required bridge; defaults are derived from the bound port. */
  readonly bridge?: BridgeOptions | undefined;
  /** Origins allowed on the WebSocket upgrade; empty means the loopback development default. */
  readonly allowedOrigins?: readonly string[] | undefined;
  /** Idle window the launcher carries for Session eviction. */
  readonly idleTimeoutMs?: number | undefined;
  /** Disable idle eviction for this server. */
  readonly keepAlive?: boolean | undefined;
  /** Where a refused upgrade is reported; defaults to stderr. */
  readonly log?: ((line: string) => void) | undefined;
  /** The time source every server-side deadline reads; defaults to the system clock. */
  readonly clock?: ServerClock | undefined;
}

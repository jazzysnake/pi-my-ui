/** What a running server is told once, at start. Tests override the paths and the pi launch. */

import type { ServerClock } from "./clock.js";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;

/** How the server launches the Pi children it owns. */
export interface PiLaunchOptions {
  readonly cliPath?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

export interface ServerConfig {
  /** The project directory the server is started for. */
  readonly cwd: string;
  readonly sessionDir?: string | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly pi?: PiLaunchOptions | undefined;
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

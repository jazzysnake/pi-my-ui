/**
 * The bridge extension, loaded into every Pi child. It connects to the server's user-only Unix
 * socket on `session_start`; the server serves the Session only once that handshake is done, so a
 * child without a bridge is a loud server failure, not a Session that quietly lacks a capability.
 * The extension is otherwise inert: it never spawns, stops or consumes a subagent, and it never
 * writes Session content.
 */

import { BRIDGE_SOCKET_ENV_VAR } from "@pi-my-ui/protocol";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { BRIDGE_LOG_PREFIX, BridgeClient, type BridgeLog } from "./client.js";

export {
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_LOG_PREFIX,
  BRIDGE_RECONNECT_DELAYS_MS,
} from "./client.js";
export { BridgeClient, type BridgeClientOptions, type BridgeLog } from "./client.js";

function defaultLog(line: string): void {
  // RPC mode reserves stdout for protocol records, so every diagnostic goes to stderr.
  console.error(line);
}

/**
 * Wire the bridge onto a pi session. Exported so the extension's wiring can be named in one place;
 * pi calls the default export below.
 */
export function registerBridge(pi: ExtensionAPI, log: BridgeLog = defaultLog): void {
  let client: BridgeClient | undefined;

  pi.on("session_start", (_event, ctx) => {
    const socketPath = process.env[BRIDGE_SOCKET_ENV_VAR];
    if (socketPath === undefined || socketPath === "") {
      log(`${BRIDGE_LOG_PREFIX} ${BRIDGE_SOCKET_ENV_VAR} is not set; this session has no bridge`);
      return;
    }
    client?.stop();
    client = new BridgeClient({
      socketPath,
      sessionId: ctx.sessionManager.getSessionId(),
      pid: process.pid,
      log,
    });
    client.start();
  });

  pi.on("session_shutdown", () => {
    client?.stop();
    client = undefined;
  });
}

/** pi extension factory; the compiled file is loaded with `--extension`. */
export default function registerBridgeExtension(pi: ExtensionAPI): void {
  registerBridge(pi);
}

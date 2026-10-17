/**
 * The Sessions this server serves, one Pi child each. Hosts are keyed both by the Session file pi
 * resolves and by the Session id, so a file a client already watched cannot start a second writer
 * and a fresh Session cannot be adopted twice.
 */

import { randomUUID } from "node:crypto";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ProtocolError, ProtocolErrorCode, type SessionActivity } from "@pi-my-ui/protocol";

import type { ServerConfig } from "./config.js";
import { systemClock } from "./clock.js";
import { withBridgeLaunch } from "./bridge/launch.js";
import { createSessionHost, type BridgeGate, type SessionHost } from "./session-host.js";
import type { PiSessionTarget } from "./pi-child.js";

export interface SessionPool {
  hostFor(sessionId: string): Promise<SessionHost>;
  /** Start a fresh Session with a server-generated id; the child names its own file. */
  create(): SessionHost;
  /** The live working state of every Session with a started child, keyed by Session id. */
  activityById(): Readonly<Record<string, SessionActivity>>;
  close(): Promise<void>;
}

/** Where the pool's children find the bridge, and how a Session waits for its handshake. */
export interface SessionPoolBridge {
  readonly socketPath: string;
  readonly extensionEntry?: string | undefined;
  readonly gate: BridgeGate;
}

/** What the pool tells its owner about the Sessions it holds. */
export interface SessionPoolListeners {
  readonly onActivity?: ((sessionId: string, activity: SessionActivity) => void) | undefined;
}

export function createSessionPool(
  config: ServerConfig,
  bridge: SessionPoolBridge,
  listeners: SessionPoolListeners = {},
): SessionPool {
  const hostsById = new Map<string, SessionHost>();
  const hostsByFile = new Map<string, SessionHost>();
  const pending = new Map<string, Promise<SessionHost>>();

  function startHost(sessionId: string, target: PiSessionTarget): SessionHost {
    const host = createSessionHost({
      sessionId,
      target,
      // The extension is resolved here, when a child is actually needed, so a server that never
      // starts one (the health endpoint, a static check) needs no built bridge.
      launch: withBridgeLaunch({ cwd: config.cwd, ...config.pi }, bridge),
      bridge: bridge.gate,
      clock: config.clock ?? systemClock,
      onActivity: listeners.onActivity,
    });
    hostsById.set(sessionId, host);
    return host;
  }

  async function hostFor(sessionId: string): Promise<SessionHost> {
    const runningById = hostsById.get(sessionId);
    if (runningById !== undefined) {
      return runningById;
    }
    const sessionFile = SessionManager.findById(config.cwd, sessionId, config.sessionDir);
    if (sessionFile === undefined) {
      throw new ProtocolError(
        ProtocolErrorCode.UnknownSession,
        `unknown session ${JSON.stringify(sessionId)}`,
      );
    }
    const running = hostsByFile.get(sessionFile);
    if (running !== undefined) {
      hostsById.set(sessionId, running);
      return running;
    }
    const starting = pending.get(sessionFile);
    if (starting !== undefined) {
      return await starting;
    }
    const started = Promise.resolve(startHost(sessionId, { kind: "file", sessionFile }));
    pending.set(sessionFile, started);
    const host = await started;
    pending.delete(sessionFile);
    hostsByFile.set(sessionFile, host);
    return host;
  }

  return {
    hostFor,
    create() {
      const sessionId = randomUUID();
      return startHost(sessionId, { kind: "id", sessionId });
    },
    activityById() {
      const activity: Record<string, SessionActivity> = {};
      for (const [sessionId, host] of hostsById) {
        activity[sessionId] = host.activity;
      }
      return activity;
    },
    async close() {
      const closing = [...new Set(hostsById.values())].map((host) => host.close());
      hostsById.clear();
      hostsByFile.clear();
      pending.clear();
      await Promise.all(closing);
    },
  };
}

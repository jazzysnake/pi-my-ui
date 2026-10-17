/**
 * The Sessions this server serves, one Pi child each. Hosts are keyed both by the Session file pi
 * resolves and by the Session id, so a file a client already watched cannot start a second writer
 * and a fresh Session cannot be adopted twice.
 *
 * The pool also decides when a child is not worth keeping: a Session nobody watches, with nothing
 * running, is evicted after the idle window. Every deadline is scheduled on the injected clock, so
 * the window is a fact about time the server can be told rather than something a test waits out.
 */

import { randomUUID } from "node:crypto";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ProtocolError, ProtocolErrorCode, type SessionActivity } from "@pi-my-ui/protocol";

import type { ServerConfig } from "./config.js";
import { systemClock, type ServerClock, type ServerTimer } from "./clock.js";
import { withBridgeLaunch } from "./bridge/launch.js";
import { createSessionHost, type BridgeGate, type SessionHost } from "./session-host.js";
import type { PiSessionTarget } from "./pi-child.js";

/** How long a Session's child is kept with no viewer, no run and no request. */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

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
  const clock: ServerClock = config.clock ?? systemClock;
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const keepAlive = config.keepAlive ?? false;
  let eviction: ServerTimer | undefined;
  let scheduledFor: number | undefined;

  function uniqueHosts(): SessionHost[] {
    return [...new Set(hostsById.values())];
  }

  /**
   * Arm one timer for the nearest deadline in the pool, so the first Session to fall idle is the one
   * the timer is about. Re-arming is idempotent: a publish that changes nothing about eviction leaves
   * the armed timer alone.
   */
  function scheduleEviction(): void {
    if (keepAlive) {
      return;
    }
    let dueAt: number | undefined;
    for (const host of uniqueHosts()) {
      const candidate = host.evictionDueAt(idleTimeoutMs);
      if (candidate !== undefined && (dueAt === undefined || candidate < dueAt)) {
        dueAt = candidate;
      }
    }
    if (dueAt === undefined) {
      eviction?.cancel();
      eviction = undefined;
      scheduledFor = undefined;
      return;
    }
    if (eviction !== undefined && scheduledFor === dueAt) {
      return;
    }
    eviction?.cancel();
    scheduledFor = dueAt;
    eviction = clock.setTimeout(
      () => {
        eviction = undefined;
        scheduledFor = undefined;
        void evictDue();
      },
      Math.max(0, dueAt - clock.now()),
    );
  }

  async function evictDue(): Promise<void> {
    const now = clock.now();
    const due = uniqueHosts().filter((host) => {
      const candidate = host.evictionDueAt(idleTimeoutMs);
      return candidate !== undefined && candidate <= now;
    });
    await Promise.all(due.map((host) => host.evict()));
    scheduleEviction();
  }

  function startHost(sessionId: string, target: PiSessionTarget): SessionHost {
    const host = createSessionHost({
      sessionId,
      target,
      // The extension is resolved here, when a child is actually needed, so a server that never
      // starts one (the health endpoint, a static check) needs no built bridge.
      launch: withBridgeLaunch({ cwd: config.cwd, ...config.pi }, bridge),
      bridge: bridge.gate,
      clock,
      onActivity: (changedSessionId, activity) => {
        listeners.onActivity?.(changedSessionId, activity);
        scheduleEviction();
      },
      onIdleChange: scheduleEviction,
    });
    hostsById.set(sessionId, host);
    scheduleEviction();
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
      eviction?.cancel();
      eviction = undefined;
      scheduledFor = undefined;
      const closing = [...new Set(hostsById.values())].map((host) => host.close());
      hostsById.clear();
      hostsByFile.clear();
      pending.clear();
      await Promise.all(closing);
    },
  };
}

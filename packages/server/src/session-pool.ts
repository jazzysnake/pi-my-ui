/**
 * The Sessions this server serves, one Pi child each. Hosts are keyed both by the Session file pi
 * resolves and by the pair that names the Session on the wire, so a file a client already watched
 * cannot start a second writer and a fresh Session cannot be adopted twice.
 *
 * The pair is what makes lookup a point read rather than a search: a Session id is only meaningful
 * inside its Project, and `SessionManager.findById` is asked for that Project alone.
 *
 * The pool also decides when a child is not worth keeping: a Session nobody watches, with nothing
 * running, is evicted after the idle window. Every deadline is scheduled on the injected clock, so
 * the window is a fact about time the server can be told rather than something a test waits out.
 */

import { randomUUID } from "node:crypto";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  ProtocolError,
  ProtocolErrorCode,
  type SessionActivity,
  type SessionRef,
} from "@pi-my-ui/protocol";

import { DEFAULT_IDLE_TIMEOUT_MS, type ServerConfig } from "./config.js";
import { systemClock, type ServerClock, type ServerTimer } from "./clock.js";
import { withBridgeLaunch } from "./bridge/launch.js";
import { createProjectRegistry, type ProjectRegistry } from "./projects.js";
import { createSessionHost, type BridgeGate, type SessionHost } from "./session-host.js";
import type { PiSessionTarget } from "./pi-child.js";

export interface SessionPool {
  hostFor(session: SessionRef): Promise<SessionHost>;
  /** Start a fresh Session in `project` with a server-generated id; the child names its own file. */
  create(project: string): SessionHost;
  /** The live working state of one Project's started children, keyed by Session id. */
  activityById(project: string): Readonly<Record<string, SessionActivity>>;
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
  readonly onActivity?: ((session: SessionRef, activity: SessionActivity) => void) | undefined;
}

/** One map key for a pair, so a Project path containing the separator cannot collide with an id. */
function pairKey(session: SessionRef): string {
  return `${session.project}\0${session.id}`;
}

export function createSessionPool(
  config: ServerConfig,
  bridge: SessionPoolBridge,
  listeners: SessionPoolListeners = {},
  registry: ProjectRegistry = createProjectRegistry(config.projects),
): SessionPool {
  const hostsByPair = new Map<string, SessionHost>();
  const hostsByFile = new Map<string, SessionHost>();
  const pending = new Map<string, Promise<SessionHost>>();
  const clock: ServerClock = config.clock ?? systemClock;
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const keepAlive = config.keepAlive ?? false;
  let eviction: ServerTimer | undefined;
  let scheduledFor: number | undefined;

  function uniqueHosts(): SessionHost[] {
    return [...new Set(hostsByPair.values())];
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

  function startHost(session: SessionRef, target: PiSessionTarget): SessionHost {
    const host = createSessionHost({
      session,
      target,
      // The extension is resolved here, when a child is actually needed, so a server that never
      // starts one (the health endpoint, a static check) needs no built bridge.
      launch: withBridgeLaunch({ cwd: session.project, ...config.pi }, bridge),
      bridge: bridge.gate,
      clock,
      onActivity: (changed, activity) => {
        listeners.onActivity?.(changed, activity);
        scheduleEviction();
      },
      onIdleChange: scheduleEviction,
    });
    hostsByPair.set(pairKey(session), host);
    scheduleEviction();
    return host;
  }

  async function hostFor(session: SessionRef): Promise<SessionHost> {
    registry.require(session.project);
    const key = pairKey(session);
    const runningByPair = hostsByPair.get(key);
    if (runningByPair !== undefined) {
      return runningByPair;
    }
    const sessionFile = SessionManager.findById(session.project, session.id, config.sessionDir);
    if (sessionFile === undefined) {
      throw new ProtocolError(
        ProtocolErrorCode.UnknownSession,
        `unknown session ${JSON.stringify(session.id)} in ${JSON.stringify(session.project)}`,
        session.id,
      );
    }
    const running = hostsByFile.get(sessionFile);
    if (running !== undefined) {
      hostsByPair.set(key, running);
      return running;
    }
    const starting = pending.get(sessionFile);
    if (starting !== undefined) {
      return await starting;
    }
    const started = Promise.resolve(startHost(session, { kind: "file", sessionFile }));
    pending.set(sessionFile, started);
    const host = await started;
    pending.delete(sessionFile);
    hostsByFile.set(sessionFile, host);
    return host;
  }

  return {
    hostFor,
    create(project) {
      const session = { project: registry.require(project), id: randomUUID() };
      return startHost(session, { kind: "id", sessionId: session.id });
    },
    activityById(project) {
      const activity: Record<string, SessionActivity> = {};
      for (const host of uniqueHosts()) {
        if (host.session.project === project) {
          activity[host.sessionId] = host.activity;
        }
      }
      return activity;
    },
    async close() {
      eviction?.cancel();
      eviction = undefined;
      scheduledFor = undefined;
      const closing = uniqueHosts().map((host) => host.close());
      hostsByPair.clear();
      hostsByFile.clear();
      pending.clear();
      await Promise.all(closing);
    },
  };
}

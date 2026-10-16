/**
 * The Sessions this server serves, one Pi child each. A host is keyed by the Session file pi
 * resolves, not by the id a client sent, so two ids cannot start two writers for one file.
 */

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

import type { ServerConfig } from "./config.js";
import { createSessionHost, type SessionHost } from "./session-host.js";

export interface SessionPool {
  hostFor(sessionId: string): Promise<SessionHost>;
  close(): Promise<void>;
}

export function createSessionPool(config: ServerConfig): SessionPool {
  const hosts = new Map<string, SessionHost>();
  const pending = new Map<string, Promise<SessionHost>>();

  function startHost(sessionId: string, sessionFile: string): Promise<SessionHost> {
    const host = createSessionHost({
      sessionId,
      sessionFile,
      launch: { cwd: config.cwd, ...config.pi },
    });
    hosts.set(sessionFile, host);
    pending.delete(sessionFile);
    return Promise.resolve(host);
  }

  async function hostFor(sessionId: string): Promise<SessionHost> {
    const sessionFile = SessionManager.findById(config.cwd, sessionId, config.sessionDir);
    if (sessionFile === undefined) {
      throw new ProtocolError(
        ProtocolErrorCode.UnknownSession,
        `unknown session ${JSON.stringify(sessionId)}`,
      );
    }
    const running = hosts.get(sessionFile);
    if (running !== undefined) {
      return running;
    }
    const starting = pending.get(sessionFile);
    if (starting !== undefined) {
      return await starting;
    }
    const started = startHost(sessionId, sessionFile);
    pending.set(sessionFile, started);
    return await started;
  }

  return {
    hostFor,
    async close() {
      const closing = [...hosts.values()].map((host) => host.close());
      hosts.clear();
      pending.clear();
      await Promise.all(closing);
    },
  };
}

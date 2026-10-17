/**
 * The server's bridge listener: a user-only Unix socket that every Pi child connects to before its
 * Session is served.
 *
 * A child that completes the handshake for a Session this server is serving is the only thing that
 * resolves that Session's wait; a connection for any other Session is refused. The socket path never
 * leaves the server and the child's environment, so a browser can never learn it.
 *
 * The bridge is required: if a child's bridge does not connect, its wait fails loudly and the
 * Session is not served.
 */

import { createServer, type Socket } from "node:net";
import { isAbsolute } from "node:path";

import {
  BridgeErrorCode,
  BridgeProtocolError,
  BridgeRecordType,
  encodeBridgeRecord,
  parseBridgeAgent,
  parseBridgeHello,
  subagentAgentFromBridge,
  type BridgeAgentRecord,
  type BridgeErrorInfo,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

import { BridgeConfigurationError, BridgeConnectionError, errorText } from "./errors.js";
import { bindAndSecureSocket, removeBridgeSocket } from "./socket.js";

/** How long a connection may sit before sending its `hello`. */
export const BRIDGE_HELLO_TIMEOUT_MS = 5_000;
/** Largest accepted frame; a bigger one means the peer is not speaking this protocol. */
export const BRIDGE_MAX_FRAME_CHARS = 1024 * 1024;
/**
 * How long a Session waits for its child's bridge before the wait fails. A loaded machine needs more
 * than a tick to import the extension, and a bridge that never arrives must not hang a subscribe.
 */
export const DEFAULT_BRIDGE_CONNECT_TIMEOUT_MS = 10_000;

/** A subscriber to the agent records a child's bridge sends, keyed by the child's Session. */
export type BridgeAgentListener = (sessionId: string, agent: SubagentAgent) => void;

/** Start a Session's child, then wait on this before serving the Session. */
export interface BridgeListener {
  readonly socketPath: string;
  /** Resolve once the child for `sessionId` has completed the handshake. */
  waitForSession(sessionId: string): Promise<void>;
  /** Subscribe to subagent records; returns an unsubscribe. */
  onAgent(listener: BridgeAgentListener): () => void;
  /** Stop accepting, drop connections, and remove the socket. Idempotent. */
  close(): Promise<void>;
}

export interface BridgeListenerOptions {
  readonly socketPath: string;
  readonly connectTimeoutMs?: number | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

interface PendingWait {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface Connection {
  readonly socket: Socket;
  buffer: string;
  sessionId: string | undefined;
  helloTimer: NodeJS.Timeout | undefined;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

/** Start the listener. Rejects with a typed error when the socket cannot be created or bound. */
export async function startBridgeListener(options: BridgeListenerOptions): Promise<BridgeListener> {
  const socketPath = options.socketPath;
  if (!isAbsolute(socketPath)) {
    throw new BridgeConfigurationError(
      `the bridge socket path must be absolute, got ${JSON.stringify(socketPath)}`,
    );
  }
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_BRIDGE_CONNECT_TIMEOUT_MS;
  const log =
    options.log ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
  /** Sessions this server is starting or has already served a handshake for. */
  const known = new Set<string>();
  const pendingWaits = new Map<string, PendingWait>();
  const liveConnections = new Map<string, Socket>();
  const connections = new Set<Connection>();
  const agentListeners = new Set<BridgeAgentListener>();
  let closed = false;

  const failWait = (sessionId: string, message: string): void => {
    const pending = pendingWaits.get(sessionId);
    if (pending === undefined) {
      return;
    }
    pendingWaits.delete(sessionId);
    clearTimeout(pending.timer);
    log(`bridge: ${message}`);
    pending.reject(new BridgeConnectionError(sessionId, message));
  };

  function clearHelloTimer(connection: Connection): void {
    if (connection.helloTimer !== undefined) {
      clearTimeout(connection.helloTimer);
      connection.helloTimer = undefined;
    }
  }

  const refuse = (connection: Connection, error: BridgeErrorInfo): void => {
    clearHelloTimer(connection);
    log(`bridge: refused a connection: ${error.message}`);
    if (connection.socket.destroyed) {
      return;
    }
    connection.socket.end(
      encodeBridgeRecord({ type: BridgeRecordType.HelloAck, ok: false, error }),
      () => {
        connection.socket.destroy();
      },
    );
  };

  const onHello = (connection: Connection, sessionId: string, pid: number): void => {
    if (!known.has(sessionId) && !pendingWaits.has(sessionId)) {
      refuse(connection, {
        code: BridgeErrorCode.ForeignConnection,
        message: `session ${quoted(sessionId)} is not one this server is serving`,
      });
      return;
    }
    clearHelloTimer(connection);
    known.add(sessionId);
    const previous = liveConnections.get(sessionId);
    if (previous !== undefined && previous !== connection.socket) {
      previous.destroy();
    }
    liveConnections.set(sessionId, connection.socket);
    connection.sessionId = sessionId;
    connection.socket.write(encodeBridgeRecord({ type: BridgeRecordType.HelloAck, ok: true }));
    log(`bridge: session ${quoted(sessionId)} connected (pid ${String(pid)})`);
    const pending = pendingWaits.get(sessionId);
    if (pending !== undefined) {
      pendingWaits.delete(sessionId);
      clearTimeout(pending.timer);
      pending.resolve();
    }
  };

  const handleLine = (connection: Connection, line: string): void => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      refuse(connection, {
        code: BridgeErrorCode.MalformedPayload,
        message: `invalid JSON: ${errorText(error)}`,
      });
      return;
    }
    if (connection.sessionId === undefined) {
      let hello;
      try {
        hello = parseBridgeHello(value);
      } catch (error) {
        refuse(connection, {
          code: BridgeErrorCode.MalformedPayload,
          message: error instanceof BridgeProtocolError ? error.message : errorText(error),
        });
        return;
      }
      onHello(connection, hello.sessionId, hello.pid);
      return;
    }
    const sessionId = connection.sessionId;
    let agent: BridgeAgentRecord;
    try {
      agent = parseBridgeAgent(value);
    } catch (error) {
      log(
        `bridge: dropping session ${quoted(sessionId)} after a bad record: ` +
          (error instanceof BridgeProtocolError ? error.message : errorText(error)),
      );
      connection.socket.destroy();
      return;
    }
    // Records for a Session this server no longer serves have no Projection to advance.
    if (!known.has(sessionId)) {
      return;
    }
    for (const listener of agentListeners) {
      listener(sessionId, subagentAgentFromBridge(agent));
    }
  };

  const onData = (connection: Connection, chunk: string): void => {
    connection.buffer += chunk;
    if (connection.buffer.length > BRIDGE_MAX_FRAME_CHARS) {
      refuse(connection, {
        code: BridgeErrorCode.MalformedPayload,
        message: `frame exceeded ${String(BRIDGE_MAX_FRAME_CHARS)} characters`,
      });
      return;
    }
    let newline = connection.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = connection.buffer.slice(0, newline);
      connection.buffer = connection.buffer.slice(newline + 1);
      if (line.trim() !== "") {
        handleLine(connection, line);
      }
      newline = connection.buffer.indexOf("\n");
    }
  };

  const server = createServer((socket) => {
    const connection: Connection = {
      socket,
      buffer: "",
      sessionId: undefined,
      helloTimer: undefined,
    };
    connections.add(connection);
    socket.setEncoding("utf8");
    connection.helloTimer = setTimeout(() => {
      refuse(connection, {
        code: BridgeErrorCode.MalformedPayload,
        message: "no hello within the bound",
      });
    }, BRIDGE_HELLO_TIMEOUT_MS);
    connection.helloTimer.unref();
    socket.on("data", (chunk: string) => {
      onData(connection, chunk);
    });
    socket.on("error", (error: Error) => {
      log(`bridge: connection error: ${error.message}`);
    });
    socket.on("close", () => {
      connections.delete(connection);
      clearHelloTimer(connection);
      if (
        connection.sessionId !== undefined &&
        liveConnections.get(connection.sessionId) === connection.socket
      ) {
        liveConnections.delete(connection.sessionId);
      }
    });
  });

  try {
    await bindAndSecureSocket(server, socketPath);
  } catch (error) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    throw error;
  }
  log(`bridge: listening on ${socketPath}`);

  return {
    socketPath,
    waitForSession(sessionId: string): Promise<void> {
      if (closed) {
        return Promise.reject(new BridgeConnectionError(sessionId, "the bridge listener stopped"));
      }
      if (liveConnections.has(sessionId)) {
        return Promise.resolve();
      }
      const existing = pendingWaits.get(sessionId);
      if (existing !== undefined) {
        return existing.promise;
      }
      let resolveWait!: () => void;
      let rejectWait!: (error: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
      });
      const timer = setTimeout(() => {
        failWait(
          sessionId,
          `the bridge for session ${quoted(sessionId)} did not connect within ${String(timeoutMs)}ms`,
        );
      }, timeoutMs);
      timer.unref();
      pendingWaits.set(sessionId, { promise, resolve: resolveWait, reject: rejectWait, timer });
      return promise;
    },
    onAgent(listener: BridgeAgentListener): () => void {
      agentListeners.add(listener);
      return () => {
        agentListeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      agentListeners.clear();
      for (const sessionId of [...pendingWaits.keys()]) {
        failWait(sessionId, "the bridge listener stopped before the handshake");
      }
      for (const connection of [...connections]) {
        connection.socket.destroy();
      }
      connections.clear();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      removeBridgeSocket(socketPath);
    },
  };
}

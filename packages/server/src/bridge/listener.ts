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
  parseBridgeSteerResult,
  parseBridgeTranscript,
  subagentAgentFromBridge,
  type BridgeErrorInfo,
  type BridgeSteerOutcome,
  type SubagentAgent,
} from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { errorText } from "../error-text.js";
import { BridgeConfigurationError, BridgeConnectionError } from "./errors.js";
import { bindAndSecureSocket, removeBridgeSocket } from "./socket.js";

/** How long a connection may sit before sending its `hello`. */
export const BRIDGE_HELLO_TIMEOUT_MS = 5_000;
/**
 * How long a steer waits for the child's answer. The bridge steers in-process and answers in one
 * tick, so this bound only fires for a bridge that has stopped reading its socket.
 */
export const BRIDGE_STEER_TIMEOUT_MS = 10_000;
/** Largest accepted frame; a bigger one means the peer is not speaking this protocol. */
export const BRIDGE_MAX_FRAME_CHARS = 1024 * 1024;
/**
 * How long a Session waits for its child's bridge before the wait fails. A loaded machine needs more
 * than a tick to import the extension, and a bridge that never arrives must not hang a subscribe.
 */
export const DEFAULT_BRIDGE_CONNECT_TIMEOUT_MS = 10_000;

/** A subscriber to the agent records a child's bridge sends, keyed by the child's Session. */
export type BridgeAgentListener = (sessionId: string, agent: SubagentAgent) => void;

/**
 * A subscriber to a running agent's own conversation events. They are pi's session events, carried
 * across the wire opaquely so the server can reduce them with its one projection machine.
 */
export type BridgeTranscriptListener = (
  sessionId: string,
  agentId: string,
  event: JsonAgentSessionEvent,
) => void;

/** Start a Session's child, then wait on this before serving the Session. */
export interface BridgeListener {
  readonly socketPath: string;
  /** Resolve once the child for `sessionId` has completed the handshake. */
  waitForSession(sessionId: string): Promise<void>;
  /** Subscribe to subagent records; returns an unsubscribe. */
  onAgent(listener: BridgeAgentListener): () => void;
  /** Subscribe to subagent conversation events; returns an unsubscribe. */
  onTranscript(listener: BridgeTranscriptListener): () => void;
  /**
   * Ask a Session's child to steer one running agent, bounded by {@link BRIDGE_STEER_TIMEOUT_MS}.
   * Resolves with the child's answer; never throws, so a caller reports the refusal to the browser.
   */
  steer(sessionId: string, agentId: string, message: string): Promise<BridgeSteerOutcome>;
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

interface PendingSteer {
  readonly sessionId: string;
  readonly resolve: (outcome: BridgeSteerOutcome) => void;
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
  const transcriptListeners = new Set<BridgeTranscriptListener>();
  /** Steers awaiting their child's answer, so a dropped socket or a stop never leaves one hanging. */
  const pendingSteers = new Map<string, PendingSteer>();
  let steerRequests = 0;
  let closed = false;

  /** Answer every outstanding steer for one Session with the reason it cannot be answered. */
  const failSteersFor = (sessionId: string | undefined, reason: string): void => {
    for (const [requestId, pending] of [...pendingSteers]) {
      if (sessionId !== undefined && pending.sessionId !== sessionId) {
        continue;
      }
      pendingSteers.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: reason });
    }
  };

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
      // A steer written to the replaced socket was queued by a child that is going away, so it will
      // never be answered there; the replacement explains it now rather than leaving it to time out.
      failSteersFor(sessionId, "the Session's bridge reconnected before the steer was answered");
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

  /** One record's `type`, for a peer whose frame is not yet parsed. */
  function recordTypeOf(value: unknown): unknown {
    return typeof value === "object" && value !== null
      ? (value as Readonly<Record<string, unknown>>)["type"]
      : undefined;
  }

  /**
   * Parse one post-handshake record, or drop the connection: a peer that sends a bad frame is not
   * speaking this wire, and every later frame from it is equally unreliable.
   */
  function parseOrDrop<T>(
    connection: Connection,
    sessionId: string,
    parse: (record: unknown) => T,
    value: unknown,
  ): T | undefined {
    try {
      return parse(value);
    } catch (error) {
      log(
        `bridge: dropping session ${quoted(sessionId)} after a bad record: ` +
          (error instanceof BridgeProtocolError ? error.message : errorText(error)),
      );
      connection.socket.destroy();
      return undefined;
    }
  }

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
    if (recordTypeOf(value) === BridgeRecordType.SteerResult) {
      const result = parseOrDrop(connection, sessionId, parseBridgeSteerResult, value);
      if (result === undefined) {
        return;
      }
      const pending = pendingSteers.get(result.requestId);
      if (pending === undefined) {
        return;
      }
      pendingSteers.delete(result.requestId);
      clearTimeout(pending.timer);
      pending.resolve(
        result.ok ? { ok: true } : { ok: false, error: result.error ?? "the steer was refused" },
      );
      return;
    }
    if (recordTypeOf(value) === BridgeRecordType.Transcript) {
      const transcript = parseOrDrop(connection, sessionId, parseBridgeTranscript, value);
      // Records for a Session this server no longer serves have no Projection to advance.
      if (transcript === undefined || !known.has(sessionId)) {
        return;
      }
      // The bridge forwards pi's own session events and the protocol carries them opaquely, so this
      // is the one place their pi shape is named.
      const event = transcript.event as unknown as JsonAgentSessionEvent;
      for (const listener of transcriptListeners) {
        listener(sessionId, transcript.agentId, event);
      }
      return;
    }
    const agent = parseOrDrop(connection, sessionId, parseBridgeAgent, value);
    if (agent === undefined || !known.has(sessionId)) {
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
        // The queued steer cannot be answered or delivered by a child that is gone.
        failSteersFor(
          connection.sessionId,
          "the Session's bridge disconnected before the steer was answered",
        );
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
    onTranscript(listener: BridgeTranscriptListener): () => void {
      transcriptListeners.add(listener);
      return () => {
        transcriptListeners.delete(listener);
      };
    },
    steer(sessionId: string, agentId: string, message: string): Promise<BridgeSteerOutcome> {
      if (closed) {
        return Promise.resolve({
          ok: false,
          error: "the bridge listener stopped, so the subagent could not be steered",
        });
      }
      const socket = liveConnections.get(sessionId);
      if (socket === undefined || socket.destroyed) {
        return Promise.resolve({
          ok: false,
          error: "the Session's bridge is not connected, so the subagent could not be steered",
        });
      }
      steerRequests += 1;
      const requestId = `steer-${String(steerRequests)}`;
      return new Promise<BridgeSteerOutcome>((resolve) => {
        const timer = setTimeout(() => {
          pendingSteers.delete(requestId);
          resolve({ ok: false, error: "the bridge did not answer the steer request in time" });
        }, BRIDGE_STEER_TIMEOUT_MS);
        timer.unref();
        pendingSteers.set(requestId, { sessionId, resolve, timer });
        socket.write(
          encodeBridgeRecord({
            type: BridgeRecordType.Steer,
            requestId,
            agentId,
            message,
          }),
        );
      });
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      agentListeners.clear();
      transcriptListeners.clear();
      failSteersFor(undefined, "the bridge listener stopped before the steer was answered");
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

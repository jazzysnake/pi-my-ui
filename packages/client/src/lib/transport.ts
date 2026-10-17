/**
 * The one module that opens a WebSocket. It owns the socket, the subscribe handshake, the link
 * status, the Cursor and the reconnect; every decoded frame is handed to the consumer unchanged, so
 * the store sees plain `ServerMessage` values and never the transport (ADR 0005).
 *
 * On reconnect the transport asks for the Deltas after the Cursor it last applied, so a Session
 * that kept running while the link was down is caught up without a user action.
 */

import {
  ClientMessageType,
  ServerMessageType,
  type ClientMessage,
  type Cursor,
  type ImageAttachment,
  type ServerMessage,
  type StreamingBehavior,
  type ThinkingLevel,
} from "@pi-my-ui/protocol";

/** The link states the top-bar dot renders. */
export const ConnectionStatus = {
  /** A socket is opening and the subscribe handshake has not been sent yet. */
  Connecting: "connecting",
  /** The socket is open and the subscribe handshake has been sent. */
  Connected: "connected",
  /** A live link was lost. */
  Reconnecting: "reconnecting",
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

/** First delay before a reconnect attempt, in ms. */
export const RECONNECT_INITIAL_DELAY_MS = 500;

/** Ceiling on the reconnect delay, in ms; the backoff never exceeds it. */
export const RECONNECT_MAX_DELAY_MS = 15_000;

/** Multiplier applied per consecutive failed attempt, so a dead server is not hammered. */
export const RECONNECT_BACKOFF_FACTOR = 2;

export interface TransportHandlers {
  onStatus(status: ConnectionStatus): void;
  onMessage(message: ServerMessage): void;
  /** The server generated a Session; the owner opens it. */
  onSessionCreated?(sessionId: string): void;
}

export interface TransportOptions {
  readonly url: string;
  readonly sessionId: string;
  readonly handlers: TransportHandlers;
}

export interface Transport {
  start(): void;
  stop(): void;
  /** Watch another Session without closing the link, from the start of its stream. */
  switchSession(sessionId: string): void;
  /** Ask the server to start a fresh Session; the answer opens it. Ignored while the link is down. */
  createSession(): void;
  /** Send one message to the Session's Pi child. Ignored while the link is down. */
  prompt(text: string, images?: readonly ImageAttachment[], behavior?: StreamingBehavior): void;
  /** Cancel the Session's running turn. Ignored while the link is down. */
  abort(): void;
  /** Switch the Session's model. Ignored while the link is down. */
  setModel(provider: string, modelId: string): void;
  /** Set the Session's reasoning level. Ignored while the link is down. */
  setThinkingLevel(level: ThinkingLevel): void;
  /** Turn pi's automatic compaction on or off. Ignored while the link is down. */
  setAutoCompaction(enabled: boolean): void;
  /** Ask for one directory of the server's working directory. Ignored while the link is down. */
  listDirectory(path: string): void;
  /** Ask for a bounded text preview of one file. Ignored while the link is down. */
  previewFile(path: string): void;
}

export function createTransport(options: TransportOptions): Transport {
  let socket: WebSocket | null = null;
  let cursor: Cursor | undefined;
  let activeSessionId = options.sessionId;
  let failedAttempts = 0;
  let started = false;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function send(message: ClientMessage): void {
    const current = socket;
    if (current !== null && current.readyState === WebSocket.OPEN) {
      current.send(JSON.stringify(message));
    }
  }

  function subscription(): ClientMessage {
    return cursor === undefined
      ? { type: ClientMessageType.Subscribe, sessionId: activeSessionId }
      : { type: ClientMessageType.Subscribe, sessionId: activeSessionId, cursor };
  }

  function nextBackoffDelay(): number {
    const raw = RECONNECT_INITIAL_DELAY_MS * RECONNECT_BACKOFF_FACTOR ** failedAttempts;
    failedAttempts += 1;
    return Math.min(raw, RECONNECT_MAX_DELAY_MS);
  }

  function scheduleReconnect(): void {
    if (stopped) {
      return;
    }
    options.handlers.onStatus(ConnectionStatus.Reconnecting);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, nextBackoffDelay());
  }

  function open(): void {
    if (stopped) {
      return;
    }
    options.handlers.onStatus(
      failedAttempts === 0 ? ConnectionStatus.Connecting : ConnectionStatus.Reconnecting,
    );
    const connecting = new WebSocket(options.url);
    socket = connecting;

    connecting.addEventListener("open", () => {
      if (socket !== connecting) {
        return;
      }
      failedAttempts = 0;
      connecting.send(JSON.stringify(subscription()));
      // The list is refreshed on every open, so a Session started elsewhere appears without a reload.
      connecting.send(JSON.stringify({ type: ClientMessageType.ListSessions }));
      options.handlers.onStatus(ConnectionStatus.Connected);
    });

    connecting.addEventListener("message", (event) => {
      if (socket !== connecting) {
        return;
      }
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === ServerMessageType.SessionCreated) {
        // The new Session's id is the server's; opening it is this socket's own follow-up, so the
        // subscribe goes out before the owner is told and a later frame cannot overtake it.
        activeSessionId = message.sessionId;
        cursor = undefined;
        send(subscription());
        options.handlers.onSessionCreated?.(message.sessionId);
        options.handlers.onMessage(message);
        return;
      }
      if (message.type === ServerMessageType.Snapshot || message.type === ServerMessageType.Delta) {
        // A frame from the Session switched away from is dropped before it can move the Cursor, so
        // the next subscribe starts the new Session from the beginning of its stream.
        if (message.sessionId !== activeSessionId) {
          return;
        }
        // The Cursor recorded here is the last one the store is about to apply, so a reconnect can
        // ask for exactly what comes after it.
        cursor = message.cursor;
      }
      options.handlers.onMessage(message);
    });

    // A failed attempt always fires `close`, and `close` is the one path that schedules a retry.
    connecting.addEventListener("close", () => {
      if (socket !== connecting) {
        return;
      }
      socket = null;
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (started || stopped) {
        return;
      }
      started = true;
      open();
    },
    stop() {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = socket;
      socket = null;
      current?.close();
    },
    switchSession(sessionId) {
      if (sessionId === activeSessionId) {
        return;
      }
      activeSessionId = sessionId;
      cursor = undefined;
      send(subscription());
    },
    createSession() {
      send({ type: ClientMessageType.CreateSession });
    },
    prompt(text, images, behavior) {
      send({
        type: ClientMessageType.Prompt,
        sessionId: activeSessionId,
        text,
        ...(images === undefined || images.length === 0 ? {} : { images }),
        ...(behavior === undefined ? {} : { streamingBehavior: behavior }),
      });
    },
    abort() {
      send({ type: ClientMessageType.Abort, sessionId: activeSessionId });
    },
    setModel(provider, modelId) {
      send({ type: ClientMessageType.SetModel, sessionId: activeSessionId, provider, modelId });
    },
    setThinkingLevel(level) {
      send({ type: ClientMessageType.SetThinkingLevel, sessionId: activeSessionId, level });
    },
    setAutoCompaction(enabled) {
      send({ type: ClientMessageType.SetAutoCompaction, sessionId: activeSessionId, enabled });
    },
    listDirectory(path) {
      send({ type: ClientMessageType.ListDirectory, path });
    },
    previewFile(path) {
      send({ type: ClientMessageType.PreviewFile, path });
    },
  };
}

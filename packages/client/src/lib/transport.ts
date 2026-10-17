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
  /** A Session this client asked for exists; the owner watches it. */
  onSessionOpened?(sessionId: string): void;
}

export interface TransportOptions {
  readonly url: string;
  /** The Session named by the page address, or absent when the reader has not picked one yet. */
  readonly sessionId?: string | null;
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
  /** Run a `!`/`!!` shell command. Ignored while the link is down. */
  bash(command: string, excludeFromContext: boolean): void;
  /** Send one message into a running subagent's own conversation. Ignored while the link is down. */
  steerSubagent(agentId: string, message: string): void;
  /** Ask for one settled run's own conversation on disk. Ignored while the link is down. */
  getSubagentTranscript(agentId: string): void;
  /** Cancel the Session's running turn. Ignored while the link is down. */
  abort(): void;
  /** Switch the Session's model. Ignored while the link is down. */
  setModel(provider: string, modelId: string): void;
  /** Set the Session's reasoning level. Ignored while the link is down. */
  setThinkingLevel(level: ThinkingLevel): void;
  /** Turn pi's automatic compaction on or off. Ignored while the link is down. */
  setAutoCompaction(enabled: boolean): void;
  /** Ask pi to compact the Session, optionally focusing the summary. Ignored while the link is down. */
  compact(customInstructions?: string): void;
  /** Ask for one Session's statistics. Ignored while the link is down. */
  getSessionStats(): void;
  /** Set the Session's display name in pi. Ignored while the link is down. */
  setSessionName(name: string): void;
  /** Ask pi to export the Session to HTML. Ignored while the link is down. */
  exportSession(): void;
  /** Ask pi which user messages a fork can start from. Ignored while the link is down. */
  getForkMessages(): void;
  /** Create a new Session branching from `entryId`. Ignored while the link is down. */
  forkSession(entryId: string): void;
  /** Copy the active branch into a new Session. Ignored while the link is down. */
  cloneSession(): void;
  /** Ask the server to respawn a Session's lost Pi child from its file. Ignored while down. */
  reconnect(): void;
  /** Ask the server for the Session's message tree. Ignored while the link is down. */
  getTree(): void;
  /** Move the Session's Leaf to an existing entry. Ignored while the link is down. */
  moveLeaf(entryId: string): void;
  /** Ask for one directory of the server's working directory. Ignored while the link is down. */
  listDirectory(path: string): void;
  /** Ask for a bounded text preview of one file. Ignored while the link is down. */
  previewFile(path: string): void;
}

export function createTransport(options: TransportOptions): Transport {
  let socket: WebSocket | null = null;
  let cursor: Cursor | undefined;
  let activeSessionId: string | null = options.sessionId ?? null;
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

  /** Send a frame that names the watched Session; a no-op until one is selected. */
  function sendForSession(build: (sessionId: string) => ClientMessage): void {
    const sessionId = activeSessionId;
    if (sessionId === null) {
      return;
    }
    send(build(sessionId));
  }

  /**
   * The subscribe frame, or `null` while no Session is named. Listing the Sessions needs no
   * subscription, so a bare page still opens the link and can show the list.
   */
  function subscription(): ClientMessage | null {
    if (activeSessionId === null) {
      return null;
    }
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
      const subscriptionMessage = subscription();
      if (subscriptionMessage !== null) {
        connecting.send(JSON.stringify(subscriptionMessage));
      }
      // The list is refreshed on every open, so a Session started elsewhere appears without a reload.
      connecting.send(JSON.stringify({ type: ClientMessageType.ListSessions }));
      options.handlers.onStatus(ConnectionStatus.Connected);
    });

    connecting.addEventListener("message", (event) => {
      if (socket !== connecting) {
        return;
      }
      const message = JSON.parse(String(event.data)) as ServerMessage;
      // A created Session and a fork or clone both produce one this client should watch; a vetoed
      // mutation names no Session, so it only reaches the store's notice.
      const opened =
        message.type === ServerMessageType.SessionCreated ||
        message.type === ServerMessageType.SessionForked
          ? message.sessionId
          : undefined;
      if (opened !== undefined) {
        // Opening it is this socket's own follow-up, so the subscribe goes out before the owner is
        // told and a later frame cannot overtake it.
        activeSessionId = opened;
        cursor = undefined;
        const subscriptionMessage = subscription();
        if (subscriptionMessage !== null) {
          send(subscriptionMessage);
        }
        options.handlers.onSessionOpened?.(opened);
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
      const subscriptionMessage = subscription();
      if (subscriptionMessage !== null) {
        send(subscriptionMessage);
      }
    },
    createSession() {
      send({ type: ClientMessageType.CreateSession });
    },
    prompt(text, images, behavior) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.Prompt,
        sessionId,
        text,
        ...(images === undefined || images.length === 0 ? {} : { images }),
        ...(behavior === undefined ? {} : { streamingBehavior: behavior }),
      }));
    },
    bash(command, excludeFromContext) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.Bash,
        sessionId,
        command,
        excludeFromContext,
      }));
    },
    steerSubagent(agentId, message) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.SteerSubagent,
        sessionId,
        agentId,
        message,
      }));
    },
    getSubagentTranscript(agentId) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.GetSubagentTranscript,
        sessionId,
        agentId,
      }));
    },
    abort() {
      sendForSession((sessionId) => ({ type: ClientMessageType.Abort, sessionId }));
    },
    setModel(provider, modelId) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.SetModel,
        sessionId,
        provider,
        modelId,
      }));
    },
    setThinkingLevel(level) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.SetThinkingLevel,
        sessionId,
        level,
      }));
    },
    setAutoCompaction(enabled) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.SetAutoCompaction,
        sessionId,
        enabled,
      }));
    },
    compact(customInstructions) {
      sendForSession((sessionId) => ({
        type: ClientMessageType.Compact,
        sessionId,
        ...(customInstructions === undefined || customInstructions === ""
          ? {}
          : { customInstructions }),
      }));
    },
    getSessionStats() {
      sendForSession((sessionId) => ({ type: ClientMessageType.GetSessionStats, sessionId }));
    },
    setSessionName(name) {
      sendForSession((sessionId) => ({ type: ClientMessageType.SetSessionName, sessionId, name }));
    },
    exportSession() {
      sendForSession((sessionId) => ({ type: ClientMessageType.ExportSession, sessionId }));
    },
    getForkMessages() {
      sendForSession((sessionId) => ({ type: ClientMessageType.GetForkMessages, sessionId }));
    },
    forkSession(entryId) {
      sendForSession((sessionId) => ({ type: ClientMessageType.ForkSession, sessionId, entryId }));
    },
    cloneSession() {
      sendForSession((sessionId) => ({ type: ClientMessageType.CloneSession, sessionId }));
    },
    reconnect() {
      sendForSession((sessionId) => ({ type: ClientMessageType.Reconnect, sessionId }));
    },
    getTree() {
      sendForSession((sessionId) => ({ type: ClientMessageType.GetTree, sessionId }));
    },
    moveLeaf(entryId) {
      sendForSession((sessionId) => ({ type: ClientMessageType.MoveLeaf, sessionId, entryId }));
    },
    listDirectory(path) {
      send({ type: ClientMessageType.ListDirectory, path });
    },
    previewFile(path) {
      send({ type: ClientMessageType.PreviewFile, path });
    },
  };
}

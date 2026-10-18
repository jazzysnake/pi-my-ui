/**
 * The one module that opens a WebSocket. It owns the socket, the Project and Session it watches, the
 * subscribe handshake, the link status, the Cursor and the reconnect; every decoded frame is handed
 * to the consumer unchanged, so the store sees plain `ServerMessage` values and never the transport
 * (ADR 0005).
 *
 * A Session is watched as a pair, because an id alone does not name one: the Project travels with it
 * on every subscribe and every accepted Snapshot or Delta, so switching Project can never let the
 * previous Project's stream move the Cursor.
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
  type SessionRef,
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
  onSessionOpened?(session: SessionRef): void;
  /** The registry chose a Project for this page; the owner draws that Project's state. */
  onProjectChosen?(project: string): void;
}

export interface TransportOptions {
  readonly url: string;
  /** The Project named by the page address, or absent when the address names none. */
  readonly project?: string | null;
  /** The Session named by the page address, or absent when the reader has not picked one yet. */
  readonly sessionId?: string | null;
  readonly handlers: TransportHandlers;
}

export interface Transport {
  start(): void;
  stop(): void;
  /** Watch another Project's list without closing the link, and clear the watched Session. */
  switchProject(project: string): void;
  /** Watch another Session without closing the link, from the start of its stream. */
  switchSession(session: SessionRef): void;
  /** Ask the server to start a fresh Session in the watched Project; the answer opens it. */
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
  /** Ask for one directory of the watched Project. Ignored while the link is down. */
  listDirectory(path: string): void;
  /** Ask for a bounded text preview of one file. Ignored while the link is down. */
  previewFile(path: string): void;
}

export function createTransport(options: TransportOptions): Transport {
  const linkedProject = options.project ?? null;
  const linkedSessionId = options.sessionId ?? null;
  let socket: WebSocket | null = null;
  let cursor: Cursor | undefined;
  let activeProject: string | null = linkedProject;
  let activeSession: SessionRef | null =
    linkedProject !== null && linkedSessionId !== null
      ? { project: linkedProject, id: linkedSessionId }
      : null;
  /** An `?session=` without `?project=` waits for the registry to pick the Project it belongs to. */
  let unpairedSessionId: string | null = linkedProject === null ? linkedSessionId : null;
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
  function sendForSession(build: (session: SessionRef) => ClientMessage): void {
    const session = activeSession;
    if (session === null) {
      return;
    }
    send(build(session));
  }

  function sendListSessions(): void {
    if (activeProject !== null) {
      send({ type: ClientMessageType.ListSessions, project: activeProject });
    }
  }

  /**
   * The subscribe frame, or `null` while no Session is named. Listing the Sessions needs no
   * subscription, so a bare page still opens the link and can show the list.
   */
  function subscription(): ClientMessage | null {
    if (activeSession === null) {
      return null;
    }
    return cursor === undefined
      ? { type: ClientMessageType.Subscribe, session: activeSession }
      : { type: ClientMessageType.Subscribe, session: activeSession, cursor };
  }

  function sendSubscription(): void {
    const message = subscription();
    if (message !== null) {
      send(message);
    }
  }

  /** Choose from the registry the same way every reload does: the linked Project, else the first. */
  function projectFrom(served: readonly string[]): string | null {
    if (linkedProject !== null) {
      return served.includes(linkedProject) ? linkedProject : null;
    }
    return served[0] ?? null;
  }

  function adoptProject(project: string | null): void {
    if (project === activeProject) {
      return;
    }
    activeProject = project;
    activeSession = null;
    cursor = undefined;
    if (project !== null) {
      options.handlers.onProjectChosen?.(project);
      sendListSessions();
    }
  }

  /** A Session the page named before the registry chose its Project becomes a pair now. */
  function pairInitialSession(): void {
    if (activeSession !== null || unpairedSessionId === null || activeProject === null) {
      return;
    }
    activeSession = { project: activeProject, id: unpairedSessionId };
    unpairedSessionId = null;
    sendSubscription();
    options.handlers.onSessionOpened?.(activeSession);
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
      // The registry is re-read on every open: the Project a remembered link named may no longer be
      // served, and the list has to be current before a Project's Sessions are asked for.
      connecting.send(JSON.stringify({ type: ClientMessageType.ListProjects }));
      if (activeProject !== null) {
        sendListSessions();
      }
      sendSubscription();
      options.handlers.onStatus(ConnectionStatus.Connected);
    });

    connecting.addEventListener("message", (event) => {
      if (socket !== connecting) {
        return;
      }
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === ServerMessageType.Projects) {
        adoptProject(projectFrom(message.projects));
        pairInitialSession();
        options.handlers.onMessage(message);
        return;
      }
      // A created Session and a fork or clone both produce one this client should watch; a vetoed
      // mutation names no Session, so it only reaches the store's notice.
      const opened: SessionRef | undefined =
        message.type === ServerMessageType.SessionCreated
          ? message.session
          : message.type === ServerMessageType.SessionForked &&
              message.sessionId !== undefined &&
              activeProject !== null
            ? { project: activeProject, id: message.sessionId }
            : undefined;
      if (opened !== undefined) {
        // Opening it is this socket's own follow-up, so the subscribe goes out before the owner is
        // told and a later frame cannot overtake it.
        activeSession = opened;
        activeProject = opened.project;
        cursor = undefined;
        sendSubscription();
        options.handlers.onSessionOpened?.(opened);
        options.handlers.onMessage(message);
        return;
      }
      if (message.type === ServerMessageType.Snapshot || message.type === ServerMessageType.Delta) {
        // A frame from the Session switched away from is dropped before it can move the Cursor, so
        // the next subscribe starts the new Session from the beginning of its stream.
        if (
          activeSession === null ||
          message.session.project !== activeSession.project ||
          message.session.id !== activeSession.id
        ) {
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
    switchProject(project) {
      if (project === activeProject) {
        return;
      }
      activeProject = project;
      activeSession = null;
      unpairedSessionId = null;
      cursor = undefined;
      sendListSessions();
    },
    switchSession(session) {
      if (
        activeSession !== null &&
        session.project === activeSession.project &&
        session.id === activeSession.id
      ) {
        return;
      }
      const projectChanged = session.project !== activeProject;
      activeProject = session.project;
      activeSession = session;
      cursor = undefined;
      if (projectChanged) {
        sendListSessions();
      }
      sendSubscription();
    },
    createSession() {
      if (activeProject === null) {
        return;
      }
      send({ type: ClientMessageType.CreateSession, project: activeProject });
    },
    prompt(text, images, behavior) {
      sendForSession((session) => ({
        type: ClientMessageType.Prompt,
        session,
        text,
        ...(images === undefined || images.length === 0 ? {} : { images }),
        ...(behavior === undefined ? {} : { streamingBehavior: behavior }),
      }));
    },
    bash(command, excludeFromContext) {
      sendForSession((session) => ({
        type: ClientMessageType.Bash,
        sessionId: session.id,
        command,
        excludeFromContext,
      }));
    },
    steerSubagent(agentId, message) {
      sendForSession((session) => ({
        type: ClientMessageType.SteerSubagent,
        sessionId: session.id,
        agentId,
        message,
      }));
    },
    getSubagentTranscript(agentId) {
      sendForSession((session) => ({
        type: ClientMessageType.GetSubagentTranscript,
        sessionId: session.id,
        agentId,
      }));
    },
    abort() {
      sendForSession((session) => ({ type: ClientMessageType.Abort, session }));
    },
    setModel(provider, modelId) {
      sendForSession((session) => ({
        type: ClientMessageType.SetModel,
        sessionId: session.id,
        provider,
        modelId,
      }));
    },
    setThinkingLevel(level) {
      sendForSession((session) => ({
        type: ClientMessageType.SetThinkingLevel,
        sessionId: session.id,
        level,
      }));
    },
    setAutoCompaction(enabled) {
      sendForSession((session) => ({
        type: ClientMessageType.SetAutoCompaction,
        sessionId: session.id,
        enabled,
      }));
    },
    compact(customInstructions) {
      sendForSession((session) => ({
        type: ClientMessageType.Compact,
        sessionId: session.id,
        ...(customInstructions === undefined || customInstructions === ""
          ? {}
          : { customInstructions }),
      }));
    },
    getSessionStats() {
      sendForSession((session) => ({
        type: ClientMessageType.GetSessionStats,
        sessionId: session.id,
      }));
    },
    setSessionName(name) {
      sendForSession((session) => ({
        type: ClientMessageType.SetSessionName,
        sessionId: session.id,
        name,
      }));
    },
    exportSession() {
      sendForSession((session) => ({
        type: ClientMessageType.ExportSession,
        sessionId: session.id,
      }));
    },
    getForkMessages() {
      sendForSession((session) => ({
        type: ClientMessageType.GetForkMessages,
        sessionId: session.id,
      }));
    },
    forkSession(entryId) {
      sendForSession((session) => ({
        type: ClientMessageType.ForkSession,
        sessionId: session.id,
        entryId,
      }));
    },
    cloneSession() {
      sendForSession((session) => ({
        type: ClientMessageType.CloneSession,
        sessionId: session.id,
      }));
    },
    reconnect() {
      sendForSession((session) => ({ type: ClientMessageType.Reconnect, sessionId: session.id }));
    },
    getTree() {
      sendForSession((session) => ({ type: ClientMessageType.GetTree, sessionId: session.id }));
    },
    moveLeaf(entryId) {
      sendForSession((session) => ({
        type: ClientMessageType.MoveLeaf,
        sessionId: session.id,
        entryId,
      }));
    },
    listDirectory(path) {
      send({ type: ClientMessageType.ListDirectory, path });
    },
    previewFile(path) {
      send({ type: ClientMessageType.PreviewFile, path });
    },
  };
}

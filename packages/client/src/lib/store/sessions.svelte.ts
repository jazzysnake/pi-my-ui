/**
 * The Sessions slice: the rows the drawer renders and the id the user has selected. Like every
 * slice it is fed by one `ServerMessage` input; a selection is a client action, not a server fact,
 * so the server's answer to a subscribe never moves the highlight.
 *
 * A row pairs the server's disk facts with two live overlays the client owns. The working flag comes
 * from the server's activity map; unread is the client's own watermark, advanced whenever a list
 * shows the Session and always suppressed for the Session being read.
 */

import {
  ServerMessageType,
  SessionActivity,
  type ServerMessage,
  type SessionSummary,
} from "@pi-my-ui/protocol";

/** One drawer row: the server's summary plus the live state the drawer paints. */
export interface SessionRow {
  readonly summary: SessionSummary;
  /** The Session's run is streaming or retrying. */
  readonly working: boolean;
  /** Output arrived after the client last viewed this Session. */
  readonly unread: boolean;
}

export interface SessionsSlice {
  /** The Project whose list these rows are, or `null` until one arrives. */
  readonly project: string | null;
  /** The rows to draw, or `null` until the first list arrives. */
  readonly rows: readonly SessionRow[] | null;
  /** The Session the user picked, or `null` before any pick. */
  readonly activeSessionId: string | null;
  /** Feed a list; one for another Project is ignored, so a switch cannot keep drawing the old list. */
  receive(message: ServerMessage, watchedProject: string | null): void;
  select(sessionId: string): void;
  /** Drop the list and its marks, so a switched-away Project leaves nothing behind. */
  clear(): void;
}

/**
 * The one display-name rule: the explicit name, else the first user message, else the id. A value
 * that is only whitespace falls through, so a row never renders blank.
 */
export function sessionDisplayName(summary: SessionSummary): string {
  const name = summary.name?.trim();
  if (name !== undefined && name !== "") {
    return name;
  }
  const firstMessage = summary.firstMessage?.trim();
  if (firstMessage !== undefined && firstMessage !== "") {
    return firstMessage;
  }
  return summary.id;
}

export function createSessionsSlice(): SessionsSlice {
  let project = $state<string | null>(null);
  let summaries = $state<readonly SessionSummary[] | null>(null);
  let activity = $state<Readonly<Record<string, SessionActivity>>>({});
  /** Per-Session `lastActivityAt` at the last moment this client viewed it. */
  let viewedAt = $state<Record<string, number>>({});
  let activeSessionId = $state<string | null>(null);

  return {
    get project() {
      return project;
    },
    get rows() {
      if (summaries === null) {
        return null;
      }
      return summaries.map((summary) => {
        const viewed = viewedAt[summary.id];
        return {
          summary,
          working: (activity[summary.id] ?? SessionActivity.Idle) === SessionActivity.Working,
          unread:
            summary.id !== activeSessionId &&
            viewed !== undefined &&
            summary.lastActivityAt > viewed,
        };
      });
    },
    get activeSessionId() {
      return activeSessionId;
    },
    receive(message, watchedProject) {
      if (message.type !== ServerMessageType.Sessions) {
        return;
      }
      if (watchedProject !== null && message.project !== watchedProject) {
        return;
      }
      project = message.project;
      summaries = message.sessions;
      activity = message.activity;
      const nextViewed: Record<string, number> = { ...viewedAt };
      for (const id of Object.keys(nextViewed)) {
        if (!message.sessions.some((summary) => summary.id === id)) {
          delete nextViewed[id];
        }
      }
      for (const summary of message.sessions) {
        // First sight records the watermark; while focused the watermark always advances, so the
        // Session being read can never mark itself unread.
        if (nextViewed[summary.id] === undefined || summary.id === activeSessionId) {
          nextViewed[summary.id] = summary.lastActivityAt;
        }
      }
      viewedAt = nextViewed;
    },
    // Writing only the id keeps this call out of the reactive dependency graph: the App effect that
    // selects the initial Session must not re-run (and restart the transport) on every list.
    select(sessionId) {
      activeSessionId = sessionId;
    },
    clear() {
      project = null;
      summaries = null;
      activity = {};
      viewedAt = {};
      activeSessionId = null;
    },
  };
}

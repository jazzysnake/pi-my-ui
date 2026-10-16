/**
 * The Sessions slice: the list the drawer renders and the id the user has selected. Like every
 * slice it is fed by one `ServerMessage` input; a selection is a client action, not a server fact,
 * so the server's answer to a subscribe never moves the highlight.
 */

import { ServerMessageType, type ServerMessage, type SessionSummary } from "@pi-my-ui/protocol";

export interface SessionsSlice {
  /** The Sessions this server serves, or `null` until the first list arrives. */
  readonly summaries: readonly SessionSummary[] | null;
  /** The Session the user picked, or `null` before any pick. */
  readonly activeSessionId: string | null;
  receive(message: ServerMessage): void;
  select(sessionId: string): void;
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
  let summaries = $state<readonly SessionSummary[] | null>(null);
  let activeSessionId = $state<string | null>(null);

  return {
    get summaries() {
      return summaries;
    },
    get activeSessionId() {
      return activeSessionId;
    },
    receive(message) {
      if (message.type === ServerMessageType.Sessions) {
        summaries = message.sessions;
      }
    },
    select(sessionId) {
      activeSessionId = sessionId;
    },
  };
}

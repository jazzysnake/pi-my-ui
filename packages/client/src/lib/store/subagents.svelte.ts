/**
 * The subagents slice: the Session's agents, the conversation of each agent the server observed live,
 * and which one the user focused. It applies the shared reducer, so what it shows cannot disagree
 * with what the server holds, and the transcript slice applies the same reducer to draw the Session's
 * own conversation.
 */

import {
  ServerMessageType,
  reduceDeltaBatch,
  type ProjectedEntry,
  type ServerMessage,
  type SessionProjection,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

export interface SubagentsSlice {
  readonly agents: readonly SubagentAgent[];
  /** The agent the view is focused on, or `null` while the main conversation is shown. */
  readonly focusedAgentId: string | null;
  /** One agent's own conversation, empty until its first entry arrives. */
  transcriptOf(agentId: string): readonly ProjectedEntry[];
  receive(message: ServerMessage): void;
  /** Focus one agent, or `null` to return to main. */
  focus(agentId: string | null): void;
  clear(): void;
}

export function createSubagentsSlice(): SubagentsSlice {
  let projection = $state<SessionProjection | null>(null);
  let focusedAgentId = $state<string | null>(null);

  /** A focus on an agent this Session no longer reports reads as main rather than a stale name. */
  function keepKnownFocus(): void {
    if (
      focusedAgentId !== null &&
      !(projection?.subagents ?? []).some((agent) => agent.id === focusedAgentId)
    ) {
      focusedAgentId = null;
    }
  }

  return {
    get agents() {
      return projection?.subagents ?? [];
    },
    get focusedAgentId() {
      return focusedAgentId;
    },
    transcriptOf(agentId) {
      const transcript = projection?.subagentTranscripts.find(
        (candidate) => candidate.agentId === agentId,
      );
      return transcript?.entries ?? [];
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        projection = message.projection;
        keepKnownFocus();
        return;
      }
      // A Delta from a switched-away Session must not change the agents that replaced it.
      if (
        message.type !== ServerMessageType.Delta ||
        projection === null ||
        message.sessionId !== projection.sessionId
      ) {
        return;
      }
      projection = reduceDeltaBatch(projection, message);
      keepKnownFocus();
    },
    focus(agentId) {
      focusedAgentId = agentId;
    },
    clear() {
      projection = null;
      focusedAgentId = null;
    },
  };
}

/**
 * The subagents slice: the Session's agents as the ServerMessage stream reports them, and which one
 * the user focused. Only agent records are kept here; the transcript slice owns the rest of the
 * Projection, so the two cannot overwrite each other.
 */

import {
  ProjectionDeltaKind,
  ServerMessageType,
  type ServerMessage,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

export interface SubagentsSlice {
  readonly agents: readonly SubagentAgent[];
  /** The agent the view is focused on, or `null` while the main conversation is shown. */
  readonly focusedAgentId: string | null;
  receive(message: ServerMessage): void;
  /** Focus one agent, or `null` to return to main. */
  focus(agentId: string | null): void;
  clear(): void;
}

export function createSubagentsSlice(): SubagentsSlice {
  let sessionId: string | null = null;
  let agents = $state<readonly SubagentAgent[]>([]);
  let focusedAgentId = $state<string | null>(null);

  /** A focus on an agent this Session no longer reports reads as main rather than a stale name. */
  function keepKnownFocus(next: readonly SubagentAgent[]): void {
    if (focusedAgentId !== null && !next.some((agent) => agent.id === focusedAgentId)) {
      focusedAgentId = null;
    }
  }

  return {
    get agents() {
      return agents;
    },
    get focusedAgentId() {
      return focusedAgentId;
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        sessionId = message.sessionId;
        agents = message.projection.subagents;
        keepKnownFocus(agents);
        return;
      }
      // A Delta from a switched-away Session must not change the agents that replaced it.
      if (message.type !== ServerMessageType.Delta || message.sessionId !== sessionId) {
        return;
      }
      for (const delta of message.deltas) {
        if (delta.kind !== ProjectionDeltaKind.SubagentUpsert) {
          continue;
        }
        const index = agents.findIndex((agent) => agent.id === delta.agent.id);
        agents =
          index === -1
            ? [...agents, delta.agent]
            : agents.map((agent, position) => (position === index ? delta.agent : agent));
      }
    },
    focus(agentId) {
      focusedAgentId = agentId;
    },
    clear() {
      sessionId = null;
      agents = [];
      focusedAgentId = null;
    },
  };
}

/**
 * The subagents slice: the Session's agents, the conversation of each agent the server observed live,
 * which one the user focused, and the steer that is on its way to it. It applies the shared reducer,
 * so what it shows cannot disagree with what the server holds, and the transcript slice applies the
 * same reducer to draw the Session's own conversation.
 */

import { isSteerable } from "../subagents/steering.js";
import {
  EntryKind,
  MessageRole,
  ServerMessageType,
  reduceDeltaBatch,
  type ProjectedEntry,
  type ServerMessage,
  type SessionProjection,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

/** The steer the focused agent is still waiting on, as the composer's status line shows it. */
export interface SteerInFlight {
  readonly agentId: string;
  readonly handle: string;
}

export interface SubagentsSlice {
  readonly agents: readonly SubagentAgent[];
  /** The agent the view is focused on, or `null` while the main conversation is shown. */
  readonly focusedAgentId: string | null;
  /** The focused agent's undelivered steer, or `null`. */
  readonly steerInFlight: SteerInFlight | null;
  /** One agent's own conversation, empty until its first entry arrives. */
  transcriptOf(agentId: string): readonly ProjectedEntry[];
  receive(message: ServerMessage): void;
  /** Focus one agent, or `null` to return to main. */
  focus(agentId: string | null): void;
  /** Record a message handed to `agentId`; it clears when pi delivers it or refuses it. */
  noteSteer(agentId: string): void;
  clear(): void;
}

/**
 * The number of the user's own turns in one agent's conversation. pi delivers a steer as a user turn,
 * so a new one is the delivery the pending line waits for — the same entry the transcript draws, not
 * a second signal that could disagree with it.
 */
function userTurnsIn(entries: readonly ProjectedEntry[]): number {
  let turns = 0;
  for (const entry of entries) {
    if (entry.kind === EntryKind.Message && entry.role === MessageRole.User) {
      turns += 1;
    }
  }
  return turns;
}

/** Drop the first `count` steers sent to `agentId`, keeping every other one in order. */
function withoutDelivered(
  pending: readonly string[],
  agentId: string,
  count: number,
): readonly string[] {
  let remaining = count;
  return pending.filter((candidate) => {
    if (candidate !== agentId || remaining === 0) {
      return true;
    }
    remaining -= 1;
    return false;
  });
}

export function createSubagentsSlice(): SubagentsSlice {
  let projection = $state<SessionProjection | null>(null);
  let focusedAgentId = $state<string | null>(null);
  /** The agents a steer is on its way to, oldest first. */
  let pending = $state<readonly string[]>([]);
  /** User turns already accounted for per agent, so an older turn is never read as a delivery. */
  let accountedTurns = $state<Readonly<Record<string, number>>>({});

  function entriesOf(agentId: string): readonly ProjectedEntry[] {
    const transcript = projection?.subagentTranscripts.find(
      (candidate) => candidate.agentId === agentId,
    );
    return transcript?.entries ?? [];
  }

  /** A focus on an agent this Session no longer reports reads as main rather than a stale name. */
  function keepKnownFocus(): void {
    if (
      focusedAgentId !== null &&
      !(projection?.subagents ?? []).some((agent) => agent.id === focusedAgentId)
    ) {
      focusedAgentId = null;
    }
  }

  /**
   * Clear the steers pi has delivered, and the ones it can no longer deliver. A steer only reaches a
   * running agent, so a run that ended without the turn arriving will never produce it: the status
   * line must stop waiting rather than claim a message is still on its way.
   *
   * A resync can renumber what the Projection holds, so a count that went backwards is adopted
   * rather than treated as a delivery: only growth is one.
   */
  function observeDeliveries(): void {
    if (pending.length === 0) {
      return;
    }
    const reported = projection?.subagents ?? [];
    pending = pending.filter((agentId) => {
      const agent = reported.find((candidate) => candidate.id === agentId);
      return agent !== undefined && isSteerable(agent.status);
    });
    if (pending.length === 0) {
      return;
    }
    const agents: string[] = [];
    for (const agentId of pending) {
      if (!agents.includes(agentId)) {
        agents.push(agentId);
      }
    }
    const accounted: Record<string, number> = { ...accountedTurns };
    for (const agentId of agents) {
      const turns = userTurnsIn(entriesOf(agentId));
      const seen = accounted[agentId];
      if (seen === undefined || turns <= seen) {
        accounted[agentId] = turns;
        continue;
      }
      pending = withoutDelivered(pending, agentId, turns - seen);
      accounted[agentId] = turns;
    }
    accountedTurns = accounted;
  }

  return {
    get agents() {
      return projection?.subagents ?? [];
    },
    get focusedAgentId() {
      return focusedAgentId;
    },
    get steerInFlight() {
      if (focusedAgentId === null || !pending.includes(focusedAgentId)) {
        return null;
      }
      const agent = (projection?.subagents ?? []).find(
        (candidate) => candidate.id === focusedAgentId,
      );
      return { agentId: focusedAgentId, handle: agent?.handle ?? focusedAgentId };
    },
    transcriptOf(agentId) {
      return entriesOf(agentId);
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        projection = message.projection;
        keepKnownFocus();
        observeDeliveries();
        return;
      }
      // A refused steer is the one other way a pending message ends: pi will not deliver it, so the
      // status line must not wait for a turn that will never come. An error about anything else (a
      // file read, another Session) says nothing about a steer in flight.
      if (message.type === ServerMessageType.Error) {
        if (
          focusedAgentId !== null &&
          message.sessionId !== undefined &&
          message.sessionId === projection?.sessionId
        ) {
          pending = pending.filter((agentId) => agentId !== focusedAgentId);
        }
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
      observeDeliveries();
    },
    focus(agentId) {
      focusedAgentId = agentId;
    },
    noteSteer(agentId) {
      if (accountedTurns[agentId] === undefined) {
        accountedTurns = { ...accountedTurns, [agentId]: userTurnsIn(entriesOf(agentId)) };
      }
      pending = [...pending, agentId];
    },
    clear() {
      projection = null;
      focusedAgentId = null;
      pending = [];
      accountedTurns = {};
    },
  };
}

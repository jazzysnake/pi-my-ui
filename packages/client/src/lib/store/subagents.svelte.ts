/**
 * The subagents slice: the Session's agents, the conversation of each agent the server observed live,
 * the conversation a settled run left in its own session file, which one the user focused, and the
 * steer that is on its way to it. It applies the shared reducer, so what it shows cannot disagree
 * with what the server holds, and the transcript slice applies the same reducer to draw the
 * Session's own conversation.
 */

import { isSteerable } from "../subagents/steering.js";
import {
  AgentEmptyKind,
  SUBAGENT_NO_TURNS_YET_MESSAGE,
  subagentFinishedMessage,
  subagentGoneMessage,
  subagentUnavailableMessage,
  type AgentEmptyState,
} from "../subagents/transcript.js";
import {
  EntryKind,
  MessageRole,
  ServerMessageType,
  SubagentTranscriptLookupKind,
  isActiveSubagent,
  reduceDeltaBatch,
  type ProjectedEntry,
  type ServerMessage,
  type SessionProjection,
  type SessionRef,
  type SubagentAgent,
  type SubagentTranscriptLookup,
  sessionMatches,
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
  /**
   * Record that a settled run's conversation on disk is being asked for, and say whether this call
   * should send the ask: only the first one does, so focusing the same run again is silent.
   */
  requestPastTranscript(agentId: string): boolean;
  /** The sentence for an empty transcript, or `null` while there are rows to draw. */
  emptyStateOf(agentId: string): AgentEmptyState | null;
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
  let active: SessionRef | null = null;
  let focusedAgentId = $state<string | null>(null);
  /** The agents a steer is on its way to, oldest first. */
  let pending = $state<readonly string[]>([]);
  /** User turns already accounted for per agent, so an older turn is never read as a delivery. */
  let accountedTurns = $state<Readonly<Record<string, number>>>({});
  /** What each settled run's own session file held, as the server read it. */
  let past = $state<Readonly<Record<string, SubagentTranscriptLookup>>>({});
  /** Agents whose on-disk conversation was already asked for, so one focus costs one read. */
  let pastRequests = $state<Readonly<Record<string, true>>>({});

  function agentOf(agentId: string): SubagentAgent | undefined {
    return (projection?.subagents ?? []).find((candidate) => candidate.id === agentId);
  }

  /** Whether this process streamed the agent's conversation, which makes the file superfluous. */
  function streamedLive(agentId: string): boolean {
    return (projection?.subagentTranscripts ?? []).some(
      (transcript) => transcript.agentId === agentId,
    );
  }

  function entriesOf(agentId: string): readonly ProjectedEntry[] {
    const streamed = projection?.subagentTranscripts.find(
      (candidate) => candidate.agentId === agentId,
    );
    if (streamed !== undefined) {
      return streamed.entries;
    }
    const read = past[agentId];
    return read?.kind === SubagentTranscriptLookupKind.Found ? read.entries : [];
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
    requestPastTranscript(agentId) {
      const agent = agentOf(agentId);
      // A live run's conversation arrives through the bridge, and a queued one has not written a
      // file yet; only a settled run this process did not stream has anything on disk to read.
      if (agent === undefined || isActiveSubagent(agent.status) || streamedLive(agentId)) {
        return false;
      }
      if (past[agentId] !== undefined || pastRequests[agentId] !== undefined) {
        return false;
      }
      pastRequests = { ...pastRequests, [agentId]: true };
      return true;
    },
    emptyStateOf(agentId) {
      if (entriesOf(agentId).length > 0) {
        return null;
      }
      const agent = agentOf(agentId);
      if (agent === undefined) {
        return null;
      }
      const read = past[agentId];
      if (read?.kind === SubagentTranscriptLookupKind.Unavailable) {
        return {
          kind: AgentEmptyKind.Unavailable,
          message: subagentUnavailableMessage(read.reason),
        };
      }
      if (isActiveSubagent(agent.status)) {
        return { kind: AgentEmptyKind.NoTurnsYet, message: SUBAGENT_NO_TURNS_YET_MESSAGE };
      }
      // A file that was read and held nothing is a finished run, not a missing conversation.
      if (read?.kind === SubagentTranscriptLookupKind.Found) {
        return { kind: AgentEmptyKind.Finished, message: subagentFinishedMessage(agent.handle) };
      }
      return { kind: AgentEmptyKind.Gone, message: subagentGoneMessage(agent.handle) };
    },
    receive(message) {
      if (message.type === ServerMessageType.SubagentTranscript) {
        // A read of another Session's run must not appear under the one on screen.
        if (!sessionMatches(active, message.session)) {
          return;
        }
        past = { ...past, [message.agentId]: message };
        return;
      }
      if (message.type === ServerMessageType.Snapshot) {
        if (active !== null && !sessionMatches(active, message.session)) {
          return;
        }
        active = message.session;
        projection = message.projection;
        // A Snapshot describes the Session as it is now, so a conversation read before it is not
        // evidence about this one, and a run that streamed in the meantime needs no file at all.
        past = {};
        pastRequests = {};
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
          message.session !== undefined &&
          active !== null &&
          sessionMatches(active, message.session)
        ) {
          pending = pending.filter((agentId) => agentId !== focusedAgentId);
        }
        return;
      }
      // A Delta from a switched-away Session must not change the agents that replaced it.
      if (
        message.type !== ServerMessageType.Delta ||
        active === null ||
        projection === null ||
        !sessionMatches(active, message.session)
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
      active = null;
      projection = null;
      focusedAgentId = null;
      pending = [];
      accountedTurns = {};
      past = {};
      pastRequests = {};
    },
  };
}

/**
 * The conversations of the agents a Session started, as the bridge reports them.
 *
 * An agent writes its own session file, so its messages are never in the Session's tree; the only
 * live source is the agent's own pi session, which the bridge subscribes to. Each agent's events run
 * through the same machine as the Session's own, so a subagent's transcript is projected exactly
 * like the main one and the two views cannot drift.
 *
 * The machine's deltas are re-scoped to the agent they came from. An agent has no Leaf in the
 * Session's tree, no Session run state, and no agents of its own that this Projection reports, so
 * the deltas carrying those are dropped instead of being published into the Session.
 */

import { ProjectionDeltaKind, type ProjectionDelta } from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { SessionProjectionMachine } from "./session-projection.js";

export interface SubagentTranscripts {
  /** Apply one event from `agentId`'s own session; the deltas are scoped to that agent. */
  apply(agentId: string, event: JsonAgentSessionEvent): readonly ProjectionDelta[];
  /**
   * Forget every conversation. A reseed rebuilds the Projection from the Session file, which holds
   * no agent's messages, and none of the agents' pi sessions outlive the child that ran them.
   */
  forgetAll(): void;
}

/**
 * `project` builds the machine for one agent: the Session's own projector, so an agent's messages are
 * turned into transcript entries by the same code as the Session's.
 */
export function createSubagentTranscripts(
  project: (agentId: string) => SessionProjectionMachine,
): SubagentTranscripts {
  const machines = new Map<string, SessionProjectionMachine>();

  function machineFor(agentId: string): SessionProjectionMachine {
    const existing = machines.get(agentId);
    if (existing !== undefined) {
      return existing;
    }
    const created = project(agentId);
    machines.set(agentId, created);
    return created;
  }

  return {
    apply(agentId, event) {
      const deltas: ProjectionDelta[] = [];
      for (const delta of machineFor(agentId).applyEvent(event)) {
        switch (delta.kind) {
          case ProjectionDeltaKind.EntryUpsert:
            deltas.push({
              kind: ProjectionDeltaKind.SubagentEntryUpsert,
              agentId,
              entry: delta.entry,
            });
            break;
          case ProjectionDeltaKind.EntryRemoved:
            deltas.push({
              kind: ProjectionDeltaKind.SubagentEntryRemoved,
              agentId,
              entryId: delta.entryId,
            });
            break;
          default:
            break;
        }
      }
      return deltas;
    },
    forgetAll() {
      machines.clear();
    },
  };
}

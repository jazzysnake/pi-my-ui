/**
 * Steering the focused subagent: what a typed message means while an agent's conversation is on
 * screen, and why the composer refuses when it cannot reach that agent.
 *
 * A steer is delivered only to a running agent, so the composer gates on the same status the bridge
 * refuses on. A queued agent has not started yet and a settled one is finished; those are different
 * facts, so they get different sentences rather than one "unavailable".
 */

import { SubagentRunKind, SubagentStatus, type SubagentAgent } from "@pi-my-ui/protocol";

/** The agent a typed message would steer: the focused one, when it can be reached at all. */
export interface SteerTarget {
  readonly agentId: string;
  readonly handle: string;
  readonly status: SubagentStatus;
}

/** The composer's explanation when the focused agent's run is over. */
export const SUBAGENT_SETTLED_NOTICE =
  "This subagent has settled; steering is only available while it is running.";

/** The composer's explanation when the focused agent has not started yet. */
export const SUBAGENT_QUEUED_NOTICE =
  "This subagent is queued and hasn't started yet; steering is available once it is running.";

/** The composer's refusal when a steer carries an image: the bridge's steer takes text only. */
export const STEER_ATTACHMENTS_MESSAGE =
  "A steering message to a subagent cannot carry an image attachment";

/** Whether an agent's run can receive a message right now. */
export function isSteerable(status: SubagentStatus): boolean {
  return status === SubagentStatus.Running;
}

/** The focused agent a typed message would steer, or `null` while the Session's own view is shown. */
export function steerTargetOf(
  agents: readonly SubagentAgent[],
  focusedAgentId: string | null,
): SteerTarget | null {
  if (focusedAgentId === null) {
    return null;
  }
  const agent = agents.find(
    (candidate) => candidate.id === focusedAgentId && candidate.runKind === SubagentRunKind.Agent,
  );
  if (agent === undefined) {
    return null;
  }
  return { agentId: agent.id, handle: agent.handle, status: agent.status };
}

/** Why a steer cannot be sent, or `null` when it can. */
export function steerRefusalOf(target: SteerTarget | null): string | null {
  if (target === null || isSteerable(target.status)) {
    return null;
  }
  return target.status === SubagentStatus.Queued ? SUBAGENT_QUEUED_NOTICE : SUBAGENT_SETTLED_NOTICE;
}

/** The status line's one sentence while a steer is on its way to the agent. */
export function steerInFlightText(handle: string): string {
  return `Steering @${handle} — waiting for pi to deliver it`;
}

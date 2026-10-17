/**
 * What the agent pill reads: `main` while the Session's own conversation is shown, or the focused
 * subagent's `@handle`, each followed by the number of agents still working.
 *
 * The count is derived only here, from the server's agent records, so the pill cannot invent an
 * activity figure. The pill is absent when the Session has no agents at all: a Session without
 * pi-subagents installed reports none, so its absence is also how a missing extension shows.
 */

import { isActiveSubagent, type SubagentAgent } from "@pi-my-ui/protocol";

/** The label the pill shows while the main conversation is focused. */
export const MAIN_AGENT_LABEL = "main";

export const AgentPillKind = {
  Main: "main",
  Subagent: "subagent",
  /** Nothing to show: this Session has never reported an agent. */
  None: "none",
} as const;

export type AgentPillKind = (typeof AgentPillKind)[keyof typeof AgentPillKind];

export type AgentPill =
  | { readonly kind: typeof AgentPillKind.None }
  | { readonly kind: typeof AgentPillKind.Main; readonly label: string }
  | {
      readonly kind: typeof AgentPillKind.Subagent;
      readonly agentId: string;
      readonly label: string;
    };

/** `main` or `@handle`, plus ` +N` when N agents are active; never a misleading `+0`. */
function pillLabel(name: string, activeCount: number): string {
  return activeCount > 0 ? `${name} +${String(activeCount)}` : name;
}

export function deriveAgentPill(
  agents: readonly SubagentAgent[],
  focusedAgentId: string | null,
): AgentPill {
  if (agents.length === 0) {
    return { kind: AgentPillKind.None };
  }
  const focused = agents.find((agent) => agent.id === focusedAgentId);
  if (focused === undefined) {
    const active = agents.filter((agent) => isActiveSubagent(agent.status)).length;
    return { kind: AgentPillKind.Main, label: pillLabel(MAIN_AGENT_LABEL, active) };
  }
  // The focused agent is where the user is looking, so it is not part of its own count.
  const others = agents.filter(
    (agent) => agent.id !== focused.id && isActiveSubagent(agent.status),
  ).length;
  return {
    kind: AgentPillKind.Subagent,
    agentId: focused.id,
    label: pillLabel(`@${focused.handle}`, others),
  };
}

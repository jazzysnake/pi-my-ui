/**
 * The rows the agent list shows: `main` first, then one row per agent, then one row per workflow run.
 *
 * The list reads the Projection's agent records and nothing else, so the row a user taps and the
 * count the pill shows are the same fact. A workflow owns the agents it starts and reports nothing
 * about itself on pi-subagents' lifecycle bus, which is why its row is its own kind: there is no
 * agent to focus inside it.
 */

import { SubagentRunKind, type SubagentAgent } from "@pi-my-ui/protocol";

import { MAIN_AGENT_LABEL } from "./pill.js";

/** What a row shows: the Session's own conversation, one agent, or one workflow run. */
export const AgentListRowKind = {
  Main: "main",
  Agent: "agent",
  Workflow: "workflow",
} as const;

export type AgentListRowKind = (typeof AgentListRowKind)[keyof typeof AgentListRowKind];

/** The way back to the Session's own conversation. */
export interface AgentListMainRow {
  readonly kind: typeof AgentListRowKind.Main;
  readonly label: string;
  readonly focused: boolean;
}

/** One agent, focusable and named by the handle the pill uses. */
export interface AgentListAgentRow {
  readonly kind: typeof AgentListRowKind.Agent;
  readonly agent: SubagentAgent;
  readonly focused: boolean;
  readonly elapsed: string | null;
}

/**
 * One workflow run. Never focusable: the run has no conversation of its own to show and no single
 * agent to steer, so a tap on it would have nowhere to go.
 */
export interface AgentListWorkflowRow {
  readonly kind: typeof AgentListRowKind.Workflow;
  readonly agent: SubagentAgent;
  readonly elapsed: string | null;
}

export type AgentListRow = AgentListMainRow | AgentListAgentRow | AgentListWorkflowRow;

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a run has lasted, as the largest unit that fits. This is a duration, not an age: the
 * Sessions sidebar renders "5m ago" and this renders how long something has been working, so the two
 * are separate formatters rather than two spellings of one.
 */
export function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < MINUTE_MS) {
    return `${String(Math.max(0, Math.round(elapsedMs / SECOND_MS)))}s`;
  }
  if (elapsedMs < HOUR_MS) {
    return `${String(Math.floor(elapsedMs / MINUTE_MS))}m`;
  }
  if (elapsedMs < DAY_MS) {
    return `${String(Math.floor(elapsedMs / HOUR_MS))}h`;
  }
  return `${String(Math.floor(elapsedMs / DAY_MS))}d`;
}

/**
 * A row's elapsed time, or `null` when the record has no start. A settled run measures to when it
 * settled, so its figure stops moving instead of counting up after the work is over.
 */
function elapsedOf(agent: SubagentAgent, nowMs: number): string | null {
  if (agent.startedAt === undefined) {
    return null;
  }
  return formatElapsed((agent.finishedAt ?? nowMs) - agent.startedAt);
}

/**
 * Build the list from the Projection's agents. Order is the Session's own: records arrive in the
 * order pi reported them, so the list never reorders itself under a tap.
 */
export function buildAgentListRows(
  agents: readonly SubagentAgent[],
  focusedAgentId: string | null,
  nowMs: number,
): readonly AgentListRow[] {
  const rows: AgentListRow[] = [
    {
      kind: AgentListRowKind.Main,
      label: MAIN_AGENT_LABEL,
      focused: focusedAgentId === null,
    },
  ];
  for (const agent of agents) {
    if (agent.runKind === SubagentRunKind.Workflow) {
      rows.push({ kind: AgentListRowKind.Workflow, agent, elapsed: elapsedOf(agent, nowMs) });
      continue;
    }
    rows.push({
      kind: AgentListRowKind.Agent,
      agent,
      focused: agent.id === focusedAgentId,
      elapsed: elapsedOf(agent, nowMs),
    });
  }
  return rows;
}

/** Subagents as the pill and the agent list read them: one spelling of each state and of each row. */

/** The lifecycle states a subagent shows in the UI. */
export const SubagentStatus = {
  /** Waiting for a concurrency slot: not started, but it will run. */
  Queued: "queued",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Stopped: "stopped",
} as const;

export type SubagentStatus = (typeof SubagentStatus)[keyof typeof SubagentStatus];

/** pi-subagents' `AgentRecord.status` values, narrowed to {@link SubagentStatus}. */
const PI_SUBAGENT_STATUS_MAP: Readonly<Record<string, SubagentStatus>> = {
  queued: SubagentStatus.Queued,
  running: SubagentStatus.Running,
  // `steered` means the run wrapped up at its turn limit, so it is an ending, not a live state.
  steered: SubagentStatus.Completed,
  completed: SubagentStatus.Completed,
  stopped: SubagentStatus.Stopped,
  aborted: SubagentStatus.Failed,
  error: SubagentStatus.Failed,
};

/** Map pi-subagents' status string, or `undefined` when this build does not know it. */
export function subagentStatusFromPi(raw: string | undefined): SubagentStatus | undefined {
  return raw === undefined ? undefined : PI_SUBAGENT_STATUS_MAP[raw];
}
/** Whether an agent counts as active: its run has not settled, and queued work is about to run. */
export function isActiveSubagent(status: SubagentStatus): boolean {
  return status === SubagentStatus.Queued || status === SubagentStatus.Running;
}

/**
 * What kind of run a row is. A workflow owns the agents it starts and reports nothing about itself
 * on pi-subagents' lifecycle bus, so it is a row of its own rather than an agent.
 */
export const SubagentRunKind = {
  Agent: "agent",
  Workflow: "workflow",
} as const;

export type SubagentRunKind = (typeof SubagentRunKind)[keyof typeof SubagentRunKind];

/** The `type` a workflow run's row carries: a workflow is not an agent type. */
export const WORKFLOW_RUN_TYPE = "workflow";

export interface SubagentAgent {
  readonly id: string;
  readonly handle: string;
  /** pi's agent type (`general-purpose`, `Explore`), or {@link WORKFLOW_RUN_TYPE} for a run. */
  readonly type: string;
  readonly status: SubagentStatus;
  readonly runKind: SubagentRunKind;
  /** When the run started, so a row can state how long it has been going; epoch ms. */
  readonly startedAt?: number;
  /** When the run settled; absent while it is still going. */
  readonly finishedAt?: number;
}

/**
 * Subagents as the pill and the agent list read them. The status mapping lives here so the bridge
 * extension and the server cannot report two spellings of the same state.
 */

/** The lifecycle states a subagent shows in the UI. */
export const SubagentStatus = {
  /** Waiting for a concurrency slot: not started, but it will run. */
  Queued: "queued",
  Running: "running",
  Completed: "completed",
  /** Ended in an error or was aborted at its turn limit. */
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

export interface SubagentAgent {
  readonly id: string;
  readonly handle: string;
  readonly status: SubagentStatus;
}

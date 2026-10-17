/**
 * Workflow runs as the agent list shows them.
 *
 * pi-subagents reports nothing about a workflow run on its lifecycle bus: the agents a run starts are
 * owned by it and filtered out of every top-level channel, and the extension's in-memory task list is
 * not reachable from another process. What the Session itself records is the launch (a
 * `SubagentWorkflow` tool call whose result carries the run id) and, once the run has settled, the
 * completion message the extension hands the model on a later turn. Those two observations are the
 * only honest source of a workflow row, and they are the same ones a resync reads, so a Synced
 * Projection cannot disagree with a live one.
 *
 * A row exists only when pi-subagents reported a run id. A call that never started a run (an
 * authoring error in the script) returns a message and no id, and a row for it would show work that
 * is not happening.
 */

import {
  SubagentRunKind,
  SubagentStatus,
  WORKFLOW_RUN_TYPE,
  type SubagentAgent,
} from "@pi-my-ui/protocol";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** pi-subagents' workflow tool name. */
export const WORKFLOW_TOOL_NAME = "SubagentWorkflow";

/** The `customType` of the completion message a settled run hands the model. */
export const WORKFLOW_RESULT_CUSTOM_TYPE = "workflow-result";

/** The `customType` of the session entry a flag-launched run leaves behind. */
export const WORKFLOW_ENTRY_CUSTOM_TYPE = "subagents:workflow";

/** What a settled run's report says about it. */
export interface WorkflowSettlement {
  readonly id: string;
  readonly status: SubagentStatus;
  readonly finishedAt: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function millisOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An entry's own timestamp, or `undefined` when pi wrote something unparseable. */
function entryTimestamp(entry: SessionEntry): number | undefined {
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The run id pi-subagents reported for a launch, taken from the tool result's details. */
export function workflowRunIdOf(details: unknown): string | undefined {
  return isRecord(details) ? stringOf(details["taskId"]) : undefined;
}

/**
 * The name a run goes by in the list: the saved-workflow name the call asked for, else the generic
 * label. An inline script names itself only inside its `meta` block, which this side does not parse:
 * a second copy of pi-subagents' parser would be another thing to keep equal to it.
 */
export function workflowHandleOf(eventArguments: unknown): string {
  return (
    (isRecord(eventArguments) ? stringOf(eventArguments["name"]) : undefined) ?? WORKFLOW_RUN_TYPE
  );
}

/** The row a launch opens: running, from the call's own start. */
export function workflowRunStarted(
  runId: string,
  handle: string,
  startedAt: number,
): SubagentAgent {
  return {
    id: runId,
    handle,
    type: WORKFLOW_RUN_TYPE,
    status: SubagentStatus.Running,
    runKind: SubagentRunKind.Workflow,
    startedAt,
  };
}

/** The status a settled run reported, in pi-subagents' run vocabulary. */
const WORKFLOW_RESULT_STATUS: Readonly<Record<string, SubagentStatus>> = {
  completed: SubagentStatus.Completed,
  stopped: SubagentStatus.Stopped,
  error: SubagentStatus.Failed,
};

/**
 * What a completion message says about its run, or `undefined` for any other entry. A status this
 * build does not know reads as failed rather than as success: a run whose end cannot be understood
 * must not be shown as having finished cleanly.
 */
export function workflowSettlementOf(entry: SessionEntry): WorkflowSettlement | undefined {
  if (entry.type !== "custom_message" || entry.customType !== WORKFLOW_RESULT_CUSTOM_TYPE) {
    return undefined;
  }
  const details = entry.details;
  if (!isRecord(details)) {
    return undefined;
  }
  const id = stringOf(details["id"]);
  const finishedAt = entryTimestamp(entry);
  if (id === undefined || finishedAt === undefined) {
    return undefined;
  }
  const raw = stringOf(details["status"]);
  const status =
    (raw === undefined ? undefined : WORKFLOW_RESULT_STATUS[raw]) ?? SubagentStatus.Failed;
  return { id, status, finishedAt };
}

/** The row a flag-launched run left behind, which is durable where a tool-launched run's is not. */
function workflowEntryRow(entry: SessionEntry): SubagentAgent | undefined {
  if (entry.type !== "custom" || entry.customType !== WORKFLOW_ENTRY_CUSTOM_TYPE) {
    return undefined;
  }
  const data = entry.data;
  if (!isRecord(data)) {
    return undefined;
  }
  const id = stringOf(data["id"]) ?? entry.id;
  const startedAt = millisOf(data["startTime"]) ?? entryTimestamp(entry);
  const finishedAt = millisOf(data["endTime"]);
  const raw = stringOf(data["status"]);
  const status =
    (raw === undefined ? undefined : WORKFLOW_RESULT_STATUS[raw]) ?? SubagentStatus.Failed;
  return {
    id,
    handle: stringOf(data["name"]) ?? WORKFLOW_RUN_TYPE,
    type: WORKFLOW_RUN_TYPE,
    status,
    runKind: SubagentRunKind.Workflow,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
  };
}

/** One launch a workflow call made, as the Session recorded it. */
interface Launch {
  readonly toolCallId: string;
  readonly handle: string;
  readonly startedAt: number | undefined;
}

function launches(entries: readonly SessionEntry[]): ReadonlyMap<string, Launch> {
  const found = new Map<string, Launch>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    if (!Array.isArray(entry.message.content)) {
      continue;
    }
    for (const block of entry.message.content) {
      if (block.type !== "toolCall" || block.name !== WORKFLOW_TOOL_NAME) {
        continue;
      }
      found.set(block.id, {
        toolCallId: block.id,
        handle: workflowHandleOf(block.arguments),
        startedAt: entryTimestamp(entry),
      });
    }
  }
  return found;
}

/**
 * Every workflow run a Session's own entries describe, in first-seen order. Launches whose result
 * named no run are dropped: pi-subagents answered the call with a message, so nothing ran.
 */
export function workflowRunsFromEntries(
  entries: readonly SessionEntry[],
): readonly SubagentAgent[] {
  const calls = launches(entries);
  const rows = new Map<string, SubagentAgent>();
  for (const entry of entries) {
    const flagRun = workflowEntryRow(entry);
    if (flagRun !== undefined) {
      rows.set(flagRun.id, flagRun);
      continue;
    }
    if (entry.type === "message" && entry.message.role === "toolResult") {
      const message = entry.message;
      if (message.toolName !== WORKFLOW_TOOL_NAME) {
        continue;
      }
      const call = calls.get(message.toolCallId);
      const runId = workflowRunIdOf(message.details);
      if (call === undefined || runId === undefined) {
        continue;
      }
      const startedAt = call.startedAt ?? entryTimestamp(entry) ?? 0;
      rows.set(runId, workflowRunStarted(runId, call.handle, startedAt));
      continue;
    }
    const settlement = workflowSettlementOf(entry);
    if (settlement === undefined) {
      continue;
    }
    const existing = rows.get(settlement.id);
    rows.set(
      settlement.id,
      existing === undefined
        ? {
            id: settlement.id,
            handle: WORKFLOW_RUN_TYPE,
            type: WORKFLOW_RUN_TYPE,
            status: settlement.status,
            runKind: SubagentRunKind.Workflow,
            startedAt: settlement.finishedAt,
            finishedAt: settlement.finishedAt,
          }
        : { ...existing, status: settlement.status, finishedAt: settlement.finishedAt },
    );
  }
  return [...rows.values()];
}

/**
 * The live half of a workflow run: the row a launch opens, and the row its completion message
 * settles. It lives beside the message stream reducer rather than inside it, the same way the live
 * `!`/`!!` card does.
 *
 * pi-subagents never reports a run on its lifecycle bus — the agents a run starts are the run's own
 * and are filtered out of every top-level channel — so these two things it writes into the Session
 * (the tool result that names the run, and the message it hands the model once the run ends) are the
 * whole of what a live Projection can know.
 */

import {
  ContentBlockType,
  SubagentRunKind,
  WORKFLOW_RUN_TYPE,
  type ProjectedMessageEntry,
  type ProjectionDelta,
  type SubagentAgent,
} from "@pi-my-ui/protocol";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  WORKFLOW_TOOL_NAME,
  workflowHandleOf,
  workflowRunIdOf,
  workflowRunStarted,
  workflowSettlementOf,
} from "./workflow-runs.js";

/** A tool result, as much of it as a workflow launch needs. */
export interface ToolResultReport {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly details?: unknown;
}

/** The Projection operations a workflow row needs, injected so this module owns no reducer state. */
export interface LiveWorkflowHost {
  /** The assistant row and block a tool call made, wherever the call sits on the path. */
  toolCall(
    toolCallId: string,
  ): { readonly entry: ProjectedMessageEntry; readonly index: number } | undefined;
  agents(): readonly SubagentAgent[];
  applySubagent(agent: SubagentAgent): readonly ProjectionDelta[];
}

export interface LiveWorkflow {
  /** The row a finished launch opens, or none when the call started no run. */
  launch(result: ToolResultReport): readonly ProjectionDelta[];
  /** The row a completion message settles, keeping the handle and start the launch reported. */
  settled(entry: SessionEntry): readonly ProjectionDelta[];
}

export function createLiveWorkflow(host: LiveWorkflowHost): LiveWorkflow {
  return {
    launch(result) {
      if (result.toolName !== WORKFLOW_TOOL_NAME) {
        return [];
      }
      const runId = workflowRunIdOf(result.details);
      const call = host.toolCall(result.toolCallId);
      if (runId === undefined || call === undefined) {
        return [];
      }
      const block = call.entry.blocks[call.index];
      const handle = workflowHandleOf(
        block !== undefined && block.type === ContentBlockType.ToolCall
          ? block.arguments
          : undefined,
      );
      return host.applySubagent(workflowRunStarted(runId, handle, call.entry.timestamp));
    },
    settled(entry) {
      const settlement = workflowSettlementOf(entry);
      if (settlement === undefined) {
        return [];
      }
      const existing = host.agents().find((agent) => agent.id === settlement.id);
      return host.applySubagent(
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
    },
  };
}

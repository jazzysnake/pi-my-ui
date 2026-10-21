/**
 * The reasons a reload is refused, read from the Projection before any child work. A reload stops
 * the Pi child, so anything the child is still doing dies with it and whatever it held lives only in
 * the live Projection, never in the Session file. Checking here rather than in the client keeps one
 * rule in one home: a second viewer's stale copy cannot disagree with it.
 */

import {
  ContentBlockType,
  EntryKind,
  MessageRole,
  ProtocolError,
  ProtocolErrorCode,
  RunStateKind,
  isActiveSubagent,
  type SessionProjection,
} from "@pi-my-ui/protocol";

/** A refusal is never success, so it carries the code the protocol reserves for it. */
function refusal(message: string): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.CommandFailed, message);
}

/** The command of a direct shell card that has no result yet, or `undefined` when none is running. */
function runningShellCommand(projection: SessionProjection): string | undefined {
  for (const entry of projection.entries) {
    if (entry.kind !== EntryKind.Message || entry.role !== MessageRole.Bash) {
      continue;
    }
    for (const block of entry.blocks) {
      if (block.type === ContentBlockType.BashExecution && block.result === undefined) {
        return block.command;
      }
    }
  }
  return undefined;
}

function activeSubagentCount(projection: SessionProjection): number {
  return projection.subagents.filter((agent) => isActiveSubagent(agent.status)).length;
}

/**
 * Why the Session cannot be reloaded without losing work, or `undefined` when it can. The turn and
 * compaction wording is pi's own, so a reader who knows pi's refusal reads the same sentence here.
 */
export function refuseReload(projection: SessionProjection): ProtocolError | undefined {
  const { runState } = projection;
  if (runState.kind === RunStateKind.Streaming || runState.kind === RunStateKind.Retrying) {
    return refusal("Wait for the current response to finish before reloading.");
  }
  if (runState.kind === RunStateKind.Compacting) {
    return refusal("Wait for compaction to finish before reloading.");
  }
  const command = runningShellCommand(projection);
  if (command !== undefined) {
    return refusal(`a shell command is still running: ${command}`);
  }
  const agents = activeSubagentCount(projection);
  if (agents > 0) {
    return refusal(
      `${String(agents)} ${agents === 1 ? "subagent is" : "subagents are"} still queued or running`,
    );
  }
  return undefined;
}

/**
 * The single Delta reducer. The server builds a Snapshot with it and the client replays Deltas with
 * it, so a Snapshot and a client that has applied every Delta since that Snapshot cannot disagree.
 */

import { ProjectionDeltaKind } from "./constants.js";
import type { DeltaBatch, ProjectedEntry, ProjectionDelta, SessionProjection } from "./model.js";
import type { SubagentAgent } from "./subagents.js";

/** Replace the entry with the same id, or append it. Idempotent by entry id. */
function upsertEntry(
  entries: readonly ProjectedEntry[],
  entry: ProjectedEntry,
): readonly ProjectedEntry[] {
  const index = entries.findIndex((existing) => existing.id === entry.id);
  if (index === -1) {
    return [...entries, entry];
  }
  return entries.map((existing, position) => (position === index ? entry : existing));
}

/** Replace the agent with the same id, or append it, keeping the order pi first reported it. */
function upsertSubagent(
  agents: readonly SubagentAgent[],
  agent: SubagentAgent,
): readonly SubagentAgent[] {
  const index = agents.findIndex((existing) => existing.id === agent.id);
  if (index === -1) {
    return [...agents, agent];
  }
  return agents.map((existing, position) => (position === index ? agent : existing));
}

/** Apply one Delta. Exhaustive over {@link ProjectionDeltaKind}; the compiler enforces it. */
export function applyDelta(
  projection: SessionProjection,
  delta: ProjectionDelta,
): SessionProjection {
  switch (delta.kind) {
    case ProjectionDeltaKind.EntryUpsert:
      return { ...projection, entries: upsertEntry(projection.entries, delta.entry) };
    case ProjectionDeltaKind.EntryRemoved:
      return {
        ...projection,
        entries: projection.entries.filter((entry) => entry.id !== delta.entryId),
      };
    case ProjectionDeltaKind.LeafChanged:
      return { ...projection, leafId: delta.leafId };
    case ProjectionDeltaKind.RunState:
      return { ...projection, runState: delta.runState };
    case ProjectionDeltaKind.SubagentUpsert:
      return { ...projection, subagents: upsertSubagent(projection.subagents, delta.agent) };
  }
}

/** Apply every Delta in a batch, in order. */
export function reduceDeltaBatch(
  projection: SessionProjection,
  batch: DeltaBatch,
): SessionProjection {
  let next = projection;
  for (const delta of batch.deltas) {
    next = applyDelta(next, delta);
  }
  return next;
}

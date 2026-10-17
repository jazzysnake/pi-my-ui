/**
 * The single Delta reducer. The server builds a Snapshot with it and the client replays Deltas with
 * it, so a Snapshot and a client that has applied every Delta since that Snapshot cannot disagree.
 */

import { ProjectionDeltaKind } from "./constants.js";
import type {
  DeltaBatch,
  ProjectedEntry,
  ProjectionDelta,
  SessionProjection,
  SubagentTranscript,
} from "./model.js";
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

/** Change one agent's conversation, leaving every other agent's untouched. */
function mapTranscript(
  transcripts: readonly SubagentTranscript[],
  agentId: string,
  change: (entries: readonly ProjectedEntry[]) => readonly ProjectedEntry[],
): readonly SubagentTranscript[] {
  return transcripts.map((transcript) =>
    transcript.agentId === agentId
      ? { ...transcript, entries: change(transcript.entries) }
      : transcript,
  );
}

/** Append an entry to an agent's conversation, opening that conversation on its first entry. */
function upsertTranscriptEntry(
  transcripts: readonly SubagentTranscript[],
  agentId: string,
  entry: ProjectedEntry,
): readonly SubagentTranscript[] {
  const existing = transcripts.some((transcript) => transcript.agentId === agentId);
  if (!existing) {
    return [...transcripts, { agentId, entries: [entry] }];
  }
  return mapTranscript(transcripts, agentId, (entries) => upsertEntry(entries, entry));
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
    case ProjectionDeltaKind.SubagentEntryUpsert:
      return {
        ...projection,
        subagentTranscripts: upsertTranscriptEntry(
          projection.subagentTranscripts,
          delta.agentId,
          delta.entry,
        ),
      };
    case ProjectionDeltaKind.SubagentEntryRemoved:
      return {
        ...projection,
        subagentTranscripts: mapTranscript(
          projection.subagentTranscripts,
          delta.agentId,
          (entries) => entries.filter((entry) => entry.id !== delta.entryId),
        ),
      };
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

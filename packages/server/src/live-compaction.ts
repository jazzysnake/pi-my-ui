/**
 * The live half of a compaction: the run state while pi summarizes, and the boundary the finished
 * compaction leaves in the transcript. It lives beside the message stream reducer rather than inside
 * it, the same way the live `!`/`!!` card does, so the reducer owns one lifecycle and not two.
 */

import {
  EntryKind,
  RunStateKind,
  type ProjectedEntry,
  type ProjectionDelta,
  type RunState,
} from "@pi-my-ui/protocol";

/** What a compaction produced, as pi reports it. */
export interface CompactionResult {
  readonly summary: string;
  readonly tokensBefore: number;
  readonly firstKeptEntryId: string;
}

/** What a finished compaction reports; this is the part of pi's event the transcript needs. */
export interface CompactionOutcome {
  readonly aborted: boolean;
  readonly result?: CompactionResult | undefined;
}

/** The Projection operations a compaction needs, injected so this module owns no reducer state. */
export interface LiveCompactionHost {
  nextId(): string;
  leafId(): string | null;
  runState(): RunState;
  emit(deltas: readonly ProjectionDelta[]): readonly ProjectionDelta[];
  upsert(entry: ProjectedEntry): ProjectionDelta;
  setLeaf(leafId: string | null): ProjectionDelta;
  setRunState(runState: RunState): ProjectionDelta;
}

export interface LiveCompaction {
  begin(): readonly ProjectionDelta[];
  end(outcome: CompactionOutcome): readonly ProjectionDelta[];
  reset(): void;
}

const IDLE: RunState = { kind: RunStateKind.Idle };

export function createLiveCompaction(host: LiveCompactionHost): LiveCompaction {
  /** The run a compaction interrupted, restored when it ends so a compaction cannot hide a run. */
  let interrupted: RunState | null = null;

  return {
    begin() {
      const current = host.runState();
      interrupted =
        current.kind === RunStateKind.Streaming || current.kind === RunStateKind.Retrying
          ? current
          : null;
      return host.emit([host.setRunState({ kind: RunStateKind.Compacting })]);
    },
    end(outcome) {
      const deltas: ProjectionDelta[] = [];
      const restored = interrupted ?? IDLE;
      interrupted = null;
      const result = outcome.result;
      if (result !== undefined && !outcome.aborted) {
        // pi saves the compaction entry without publishing it on the RPC stream, and re-reading the
        // Session file would renumber every row streamed since the last seed. The boundary is
        // therefore addressed provisionally for this connection, exactly like a streamed message; a
        // later Snapshot replaces it with the durable id pi wrote.
        const id = host.nextId();
        deltas.push(
          host.upsert({
            kind: EntryKind.CompactionBoundary,
            id,
            parentId: host.leafId(),
            timestamp: Date.now(),
            summary: result.summary,
            tokensBefore: result.tokensBefore,
            firstKeptEntryId: result.firstKeptEntryId,
          }),
          // pi makes the compaction entry the Leaf, so the next message continues after it.
          host.setLeaf(id),
        );
      }
      deltas.push(host.setRunState(restored));
      return host.emit(deltas);
    },
    reset() {
      interrupted = null;
    },
  };
}

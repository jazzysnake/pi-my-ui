/**
 * The one rendering of a run state that the transcript shows. `idle` and `streaming` render nothing
 * — a completed run must leave no status chrome behind, so the row is removed rather than dimmed.
 */

import { RunStateKind, type RunState } from "@pi-my-ui/protocol";

export interface RunStateDisplay {
  readonly kind: RunState["kind"];
  readonly label: string;
  readonly detail: string | null;
}

export function runStateDisplay(runState: RunState): RunStateDisplay | null {
  switch (runState.kind) {
    case RunStateKind.Idle:
    case RunStateKind.Streaming:
      return null;
    case RunStateKind.Retrying:
      return {
        kind: runState.kind,
        label: "Retrying",
        detail: `Attempt ${String(runState.attempt)} of ${String(runState.maxAttempts)} · ${runState.errorMessage}`,
      };
    case RunStateKind.Aborted:
      return { kind: runState.kind, label: "Aborted", detail: "stopped by you" };
    case RunStateKind.Errored:
      return { kind: runState.kind, label: "Error", detail: runState.message };
  }
}

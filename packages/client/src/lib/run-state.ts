/**
 * The one rendering of the Session's state line. `idle` and `streaming` render nothing — a completed
 * run must leave no status chrome behind, so the row is removed rather than dimmed — and a Session
 * with no Projection yet reads as starting, which is a wait, not a failure.
 */

import { RunStateKind, type PiChildExit, type RunState } from "@pi-my-ui/protocol";

/** The state line's kind before any Projection has arrived. */
export const STARTING_KIND = "starting";

export interface RunStateDisplay {
  readonly kind: RunState["kind"] | typeof STARTING_KIND;
  readonly label: string;
  readonly detail: string | null;
  /** Whether the row offers the respawn control; only a lost Pi child can be respawned from here. */
  readonly reconnect: boolean;
}

/**
 * The row shown while a Session is being started or restarted. It is deliberately the same row as a
 * run state, so a respawn is announced in the place the reader already looks, and it carries no
 * error tone: from the browser's side a cold start, a respawn after eviction and a recovery from a
 * crash are the same wait.
 */
export const STARTING_DISPLAY: RunStateDisplay = {
  kind: STARTING_KIND,
  label: "Starting…",
  detail: null,
  reconnect: false,
};

/** The exit facts as one line, so the transcript names what happened rather than "an error". */
function exitDetail(exit: PiChildExit): string {
  if (exit.signal !== null) {
    return `signal ${exit.signal}`;
  }
  return exit.exitCode === null ? "no exit code" : `exit code ${String(exit.exitCode)}`;
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
        reconnect: false,
      };
    case RunStateKind.Aborted:
      return { kind: runState.kind, label: "Aborted", detail: "stopped by you", reconnect: false };
    case RunStateKind.Errored:
      return {
        kind: runState.kind,
        label: "Error",
        detail: runState.message,
        reconnect: false,
      };
    case RunStateKind.Crashed:
      return {
        kind: runState.kind,
        label: "Pi child exited",
        detail: exitDetail(runState),
        reconnect: true,
      };
  }
}

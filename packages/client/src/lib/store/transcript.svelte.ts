/**
 * The transcript slice: one Session's Projection and the Deltas that advance it. It applies the
 * shared reducer, so a Snapshot and a replayed Delta stream build the same entries the server holds.
 */

import {
  RunStateKind,
  ServerMessageType,
  reduceDeltaBatch,
  type ProjectedEntry,
  type RunState,
  type ServerMessage,
  type SessionProjection,
} from "@pi-my-ui/protocol";

export interface TranscriptSlice {
  readonly entries: readonly ProjectedEntry[];
  readonly runState: RunState;
  /** The Session's working directory, empty until a Snapshot names it. */
  readonly cwd: string;
  receive(message: ServerMessage): void;
}

export function createTranscriptSlice(): TranscriptSlice {
  let projection = $state<SessionProjection | null>(null);

  return {
    get entries() {
      return projection?.entries ?? [];
    },
    get runState() {
      return projection?.runState ?? { kind: RunStateKind.Idle };
    },
    get cwd() {
      return projection?.cwd ?? "";
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        projection = message.projection;
        return;
      }
      if (message.type === ServerMessageType.Delta && projection !== null) {
        projection = reduceDeltaBatch(projection, message);
      }
    },
  };
}

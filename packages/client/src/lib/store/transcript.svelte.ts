/**
 * The transcript slice: one Session's Projection and the Deltas that advance it. It applies the
 * shared reducer, so a Snapshot and a replayed Delta stream build the same entries the server holds.
 *
 * It also knows whether it is waiting for a Projection for the Session it watches: before the first
 * Snapshot and while a respawn is in flight the transcript has nothing live to draw, and the Shell
 * says the Session is starting rather than leaving the reader with an empty page.
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
  /** The watched Session's id once its Projection has arrived, else `null`. */
  readonly sessionId: string | null;
  readonly runState: RunState;
  /** The Session's working directory, empty until a Snapshot names it. */
  readonly cwd: string;
  /** No live Projection for the watched Session yet: it is being started. */
  readonly starting: boolean;
  /** Advances for every Snapshot this slice accepts, so a view can anchor across a resync. */
  readonly snapshotCount: number;
  receive(message: ServerMessage): void;
  /** Drop the current Projection, so a switched-away Session leaves nothing behind. */
  clear(): void;
  /** Ask for a respawn, so the Shell shows the Session starting until its Snapshot arrives. */
  requestReconnect(): void;
}

export function createTranscriptSlice(): TranscriptSlice {
  let projection = $state<SessionProjection | null>(null);
  let waiting = $state(false);
  let snapshots = $state(0);

  return {
    get entries() {
      return projection?.entries ?? [];
    },
    get sessionId() {
      return projection?.sessionId ?? null;
    },
    get runState() {
      return projection?.runState ?? { kind: RunStateKind.Idle };
    },
    get cwd() {
      return projection?.cwd ?? "";
    },
    get starting() {
      return waiting;
    },
    get snapshotCount() {
      return snapshots;
    },
    receive(message) {
      // A Snapshot for a Session this slice is not watching would replace the transcript the user is
      // reading. The first Snapshot is accepted because nothing has named a Session yet.
      if (
        message.type === ServerMessageType.Snapshot &&
        (projection === null || message.sessionId === projection.sessionId)
      ) {
        projection = message.projection;
        waiting = false;
        snapshots += 1;
        return;
      }
      // A Delta from a switched-away Session must not advance the Projection that replaced it.
      if (
        message.type === ServerMessageType.Delta &&
        projection !== null &&
        message.sessionId === projection.sessionId
      ) {
        projection = reduceDeltaBatch(projection, message);
        waiting = false;
        return;
      }
      // A refused respawn must fall back to the state that needed one, not sit on "Starting…"
      // forever: the server answers the request it could not serve with the Session it named.
      if (
        message.type === ServerMessageType.Error &&
        projection !== null &&
        message.sessionId === projection.sessionId
      ) {
        waiting = false;
      }
    },
    clear() {
      projection = null;
      waiting = true;
    },
    requestReconnect() {
      waiting = true;
    },
  };
}

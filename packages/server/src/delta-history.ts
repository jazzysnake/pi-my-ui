/**
 * The Deltas a Session keeps for viewers that reconnect, and the answer to "what did this Cursor
 * miss". Kept apart from the host so the retention bounds are one small, checkable unit rather than
 * another concern inside the object every Session feature touches.
 */

import type { Cursor, DeltaMessage } from "@pi-my-ui/protocol";

/** Batches retained per Session; the oldest is dropped past this, falling a viewer back to a Snapshot. */
const MAX_RETAINED_BATCHES = 2048;
/** Age bound on the retained batches, so an unwatched Session does not hold Deltas indefinitely. */
const DELTA_HISTORY_TTL_MS = 5 * 60_000;

/** One published Delta batch, kept so a reconnecting viewer can replay what it missed. */
interface RetainedBatch {
  readonly message: DeltaMessage;
  readonly publishedAt: number;
}

export interface DeltaHistory {
  /** Keep one published batch, dropping whatever fell past either bound. */
  retain(message: DeltaMessage, now: number): void;
  /**
   * Every message a viewer at `from` is owed, or `undefined` when the server must send a Snapshot
   * instead. Every retained Cursor between the oldest batch's start and the current one is a batch
   * boundary, so a value in that range bridges; anything else is unknown.
   */
  missedFrom(from: Cursor | undefined, cursor: Cursor): readonly DeltaMessage[] | undefined;
  /** Forget everything: a reseed renumbers Cursors, so nothing retained describes the new stream. */
  clear(): void;
}

export function createDeltaHistory(): DeltaHistory {
  const batches: RetainedBatch[] = [];

  return {
    retain(message, now) {
      batches.push({ message, publishedAt: now });
      for (;;) {
        const oldest = batches[0];
        if (oldest === undefined) {
          return;
        }
        const tooMany = batches.length > MAX_RETAINED_BATCHES;
        const tooOld = now - oldest.publishedAt > DELTA_HISTORY_TTL_MS;
        if (!tooMany && !tooOld) {
          return;
        }
        batches.shift();
      }
    },
    missedFrom(from, cursor) {
      if (from === undefined) {
        return undefined;
      }
      const oldest = batches[0];
      if (oldest === undefined) {
        return from === cursor ? [] : undefined;
      }
      if (from < oldest.message.fromCursor || from > cursor) {
        return undefined;
      }
      return batches
        .filter((retained) => retained.message.cursor > from)
        .map((retained) => retained.message);
    },
    clear() {
      batches.length = 0;
    },
  };
}

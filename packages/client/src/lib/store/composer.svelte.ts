/**
 * The composer slice: the one error line the composer shows and the acknowledgement that a sent
 * message was accepted. Acknowledgement is the user's own entry appearing in the transcript, which
 * is the server's evidence that pi took the message; a refused message produces no entry, so the
 * composer keeps what the user typed.
 */

import {
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  ServerMessageType,
  type ServerMessage,
} from "@pi-my-ui/protocol";

export interface ComposerSlice {
  /** The last failure the server reported, or `null`. */
  readonly error: string | null;
  /** Increments once per sent message pi accepted. */
  readonly sentCount: number;
  receive(message: ServerMessage): void;
  /** Record that the composer handed a message to the transport. */
  noteSend(): void;
  clearError(): void;
}

export function createComposerSlice(): ComposerSlice {
  let error = $state<string | null>(null);
  let sentCount = $state(0);
  let awaiting = 0;

  return {
    get error() {
      return error;
    },
    get sentCount() {
      return sentCount;
    },
    receive(message) {
      if (message.type === ServerMessageType.Error) {
        error = message.error.message;
        awaiting = 0;
        return;
      }
      if (message.type !== ServerMessageType.Delta) {
        return;
      }
      for (const delta of message.deltas) {
        if (
          delta.kind !== ProjectionDeltaKind.EntryUpsert ||
          delta.entry.kind !== EntryKind.Message ||
          delta.entry.role !== MessageRole.User
        ) {
          continue;
        }
        if (awaiting > 0) {
          awaiting -= 1;
          sentCount += 1;
        }
      }
    },
    noteSend() {
      error = null;
      awaiting += 1;
    },
    clearError() {
      error = null;
    },
  };
}

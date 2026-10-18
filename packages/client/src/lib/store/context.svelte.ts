/**
 * The context slice: pi's context-window usage for the Session being watched, as the server reads it.
 * It is a read, like the Session's settings, so it is not part of the Projection: a reconnect re-reads
 * the current figure instead of replaying every change, and no Cursor moves when it changes.
 *
 * `undefined` means the server has not answered yet, `null` means pi has no figure at all (no model or
 * context window). The readout renders them differently, so the slice keeps them apart.
 */

import {
  ServerMessageType,
  type ContextUsage,
  type ServerMessage,
  type SessionRef,
  sessionMatches,
} from "@pi-my-ui/protocol";

export interface ContextSlice {
  readonly usage: ContextUsage | null | undefined;
  receive(message: ServerMessage): void;
  /** Forget the figure, so a switched-away Session's usage is never drawn under the new one's name. */
  clear(): void;
}

export function createContextSlice(): ContextSlice {
  let usage = $state<ContextUsage | null | undefined>(undefined);
  let active: SessionRef | null = null;

  return {
    get usage() {
      return usage;
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        if (active !== null && !sessionMatches(active, message.session)) {
          return;
        }
        active = message.session;
        return;
      }
      if (message.type !== ServerMessageType.ContextUsage) {
        return;
      }
      if (active !== null && !sessionMatches(active, message.session)) {
        return;
      }
      active = message.session;
      usage = message.contextUsage;
    },
    clear() {
      active = null;
      usage = undefined;
    },
  };
}

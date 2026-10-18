/**
 * The settings slice: the status strip's model, reasoning level and automatic-compaction facts.
 * Like every slice it is fed by one `ServerMessage` input. pi is the source of every value, so a
 * change is shown only once the server's re-read arrives, never from the click.
 */

import {
  ServerMessageType,
  type ServerMessage,
  type SessionRef,
  type SettingsMessage,
  sessionMatches,
} from "@pi-my-ui/protocol";

export interface SettingsSlice {
  /** The Session's settings, or `null` until the server sends them. */
  readonly settings: SettingsMessage | null;
  receive(message: ServerMessage): void;
  clear(): void;
}

export function createSettingsSlice(): SettingsSlice {
  let settings = $state<SettingsMessage | null>(null);
  let active: SessionRef | null = null;

  return {
    get settings() {
      return settings;
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        // A Snapshot for another Session is not this slice's news. A switch clears the slice, so the
        // next Snapshot is accepted without the old Session being able to blank it on the way out.
        if (active !== null && !sessionMatches(active, message.session)) {
          return;
        }
        active = message.session;
        return;
      }
      if (message.type !== ServerMessageType.Settings) {
        return;
      }
      if (active !== null && !sessionMatches(active, message.session)) {
        return;
      }
      active = message.session;
      settings = message;
    },
    clear() {
      active = null;
      settings = null;
    },
  };
}

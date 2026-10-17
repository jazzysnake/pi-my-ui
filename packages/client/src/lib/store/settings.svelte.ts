/**
 * The settings slice: the status strip's model, reasoning level and automatic-compaction facts.
 * Like every slice it is fed by one `ServerMessage` input. pi is the source of every value, so a
 * change is shown only once the server's re-read arrives, never from the click.
 */

import { ServerMessageType, type ServerMessage, type SettingsMessage } from "@pi-my-ui/protocol";

export interface SettingsSlice {
  /** The Session's settings, or `null` until the server sends them. */
  readonly settings: SettingsMessage | null;
  receive(message: ServerMessage): void;
  clear(): void;
}

export function createSettingsSlice(): SettingsSlice {
  let settings = $state<SettingsMessage | null>(null);

  return {
    get settings() {
      return settings;
    },
    receive(message) {
      if (message.type === ServerMessageType.Settings) {
        settings = message;
      }
    },
    clear() {
      settings = null;
    },
  };
}

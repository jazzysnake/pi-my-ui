/**
 * The commands slice holds what the server answered for a session command: the palette's
 * discoverable commands, the session statistics panel's numbers and the export's path. Like every
 * slice it is fed by one `ServerMessage` input; the notice is the one client-owned string, because a
 * built-in that has not landed yet and a name echo have no server message of their own.
 */

import {
  ServerMessageType,
  type CommandInfo,
  type ServerMessage,
  type SessionStats,
} from "@pi-my-ui/protocol";

export interface CommandsSlice {
  /** The Session's discoverable commands, empty until the first answer. */
  readonly discoverable: readonly CommandInfo[];
  /** The last statistics the server sent, or `null`. */
  readonly stats: SessionStats | null;
  /** The relative path of the last HTML export, or `null`. */
  readonly exportedPath: string | null;
  /** The one notice line under the composer, or `null`. */
  readonly notice: string | null;
  receive(message: ServerMessage): void;
  setNotice(text: string): void;
  /** Dismiss the stats panel and the export offer while keeping the discoverable commands. */
  dismissResults(): void;
  clear(): void;
}

export function createCommandsSlice(): CommandsSlice {
  let discoverable = $state<readonly CommandInfo[]>([]);
  let stats = $state<SessionStats | null>(null);
  let exportedPath = $state<string | null>(null);
  let notice = $state<string | null>(null);

  return {
    get discoverable() {
      return discoverable;
    },
    get stats() {
      return stats;
    },
    get exportedPath() {
      return exportedPath;
    },
    get notice() {
      return notice;
    },
    receive(message) {
      if (message.type === ServerMessageType.Commands) {
        discoverable = message.commands;
        return;
      }
      if (message.type === ServerMessageType.SessionStats) {
        stats = message.stats;
        exportedPath = null;
        notice = null;
        return;
      }
      if (message.type === ServerMessageType.SessionExported) {
        exportedPath = message.path;
        stats = null;
        notice = "Session exported as HTML.";
        return;
      }
      if (message.type === ServerMessageType.SessionRenamed) {
        notice = `Session renamed to "${message.name}".`;
        stats = null;
        exportedPath = null;
      }
    },
    setNotice(text) {
      notice = text;
      stats = null;
      exportedPath = null;
    },
    dismissResults() {
      stats = null;
      exportedPath = null;
      notice = null;
    },
    clear() {
      discoverable = [];
      stats = null;
      exportedPath = null;
      notice = null;
    },
  };
}

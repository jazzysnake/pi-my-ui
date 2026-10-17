/**
 * The commands slice holds what the server answered for a session command: the palette's
 * discoverable commands, the session statistics panel's numbers, the export's path and the messages
 * a fork can start from. Like every slice it is fed by one `ServerMessage` input; the notice is the
 * one client-owned string, because a name echo and a picker waiting on pi have no server message of
 * their own.
 */

import {
  ServerMessageType,
  SessionMutation,
  type CommandInfo,
  type ForkMessage,
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
  /** The messages a fork can start from, or `null` until pi has answered the request. */
  readonly forkMessages: readonly ForkMessage[] | null;
  /** The one notice line under the composer, or `null`. */
  readonly notice: string | null;
  receive(message: ServerMessage): void;
  setNotice(text: string): void;
  /** Clear the last fork list, so the picker waits for this Session's own answer. */
  beginForkPicker(): void;
  /** Dismiss the stats panel and the export offer while keeping the discoverable commands. */
  dismissResults(): void;
  clear(): void;
}

/** How a fork or clone ended, in one sentence; a veto is stated as nothing performed, not a failure. */
function mutationNotice(mutation: SessionMutation, created: boolean): string {
  const verb = mutation === SessionMutation.Fork ? "Fork" : "Clone";
  return created
    ? `${verb} created a new session, now open.`
    : `${verb} was cancelled, so nothing was performed.`;
}

export function createCommandsSlice(): CommandsSlice {
  let discoverable = $state<readonly CommandInfo[]>([]);
  let stats = $state<SessionStats | null>(null);
  let exportedPath = $state<string | null>(null);
  let forkMessages = $state<readonly ForkMessage[] | null>(null);
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
    get forkMessages() {
      return forkMessages;
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
        return;
      }
      if (message.type === ServerMessageType.ForkMessages) {
        forkMessages = message.messages;
        return;
      }
      if (message.type === ServerMessageType.SessionForked) {
        notice = mutationNotice(message.mutation, message.sessionId !== undefined);
        forkMessages = null;
        stats = null;
        exportedPath = null;
      }
    },
    setNotice(text) {
      notice = text;
      stats = null;
      exportedPath = null;
    },
    beginForkPicker() {
      forkMessages = null;
      notice = null;
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
      forkMessages = null;
      notice = null;
    },
  };
}

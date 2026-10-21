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
  type SessionRef,
  type SessionStats,
  sessionMatches,
} from "@pi-my-ui/protocol";

import { RELOADED_RESOURCES } from "../commands/builtins.js";

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
  /** Whether a reload was sent and its reply has not arrived, so the strip reads `Reloading…`. */
  readonly reloadPending: boolean;
  receive(message: ServerMessage): void;
  setNotice(text: string): void;
  /** Record a reload before the transport is asked, so the strip reads `Reloading…` from the tap. */
  noteReload(): void;
  /**
   * Stop waiting for a reload's reply. The link is the only thing that could carry one, so losing it
   * ends the wait rather than leaving a pending line for a reply that can never arrive.
   */
  clearReloadPending(): void;
  /** Clear the last fork list, so the picker waits for this Session's own answer. */
  beginForkPicker(): void;
  /** Dismiss the stats panel and the export offer while keeping the discoverable commands. */
  dismissResults(): void;
  clear(): void;
}

/** What a reload read again, limited to the resources this UI can show. */
const RELOADED_NOTICE = `Reloaded ${RELOADED_RESOURCES}.`;

/** How a fork or clone ended, in one sentence; a veto is stated as nothing performed, not a failure. */
function mutationNotice(mutation: SessionMutation, created: boolean): string {
  const verb = mutation === SessionMutation.Fork ? "Fork" : "Clone";
  return created
    ? `${verb} created a new session, now open.`
    : `${verb} was cancelled, so nothing was performed.`;
}

export function createCommandsSlice(): CommandsSlice {
  let discoverable = $state<readonly CommandInfo[]>([]);
  let active: SessionRef | null = null;
  let stats = $state<SessionStats | null>(null);
  let exportedPath = $state<string | null>(null);
  let forkMessages = $state<readonly ForkMessage[] | null>(null);
  let notice = $state<string | null>(null);
  let reloadPending = $state(false);

  /**
   * One strip message at a time: a new result replaces the last rather than stacking under it, so a
   * stale export path can never be read as the answer to the command just run.
   */
  function clearStrip(): void {
    notice = null;
    stats = null;
    exportedPath = null;
  }

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
    get reloadPending() {
      return reloadPending;
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        if (active !== null && !sessionMatches(active, message.session)) {
          return;
        }
        active = message.session;
        return;
      }
      if (message.type === ServerMessageType.Commands) {
        if (active !== null && !sessionMatches(active, message.session)) {
          return;
        }
        active = message.session;
        discoverable = message.commands;
        return;
      }
      if (message.type === ServerMessageType.SessionStats) {
        if (!sessionMatches(active, message.session)) {
          return;
        }
        clearStrip();
        stats = message.stats;
        return;
      }
      if (message.type === ServerMessageType.SessionExported) {
        if (!sessionMatches(active, message.session)) {
          return;
        }
        clearStrip();
        exportedPath = message.path;
        notice = "Session exported as HTML.";
        return;
      }
      if (message.type === ServerMessageType.SessionRenamed) {
        if (!sessionMatches(active, message.session)) {
          return;
        }
        clearStrip();
        notice = `Session renamed to "${message.name}".`;
        return;
      }
      if (message.type === ServerMessageType.ForkMessages) {
        if (!sessionMatches(active, message.session)) {
          return;
        }
        forkMessages = message.messages;
        return;
      }
      if (message.type === ServerMessageType.SessionForked) {
        // The transport opens a created Session before handing the answer on, so this slice has
        // already been cleared when the notice arrives. It is still about the Session that asked.
        if (active !== null && !sessionMatches(active, message.sourceSession)) {
          return;
        }
        clearStrip();
        notice = mutationNotice(message.mutation, message.session !== undefined);
        forkMessages = null;
      }
      if (message.type === ServerMessageType.Reloaded) {
        if (!sessionMatches(active, message.session)) {
          return;
        }
        reloadPending = false;
        clearStrip();
        notice = RELOADED_NOTICE;
        return;
      }
      if (message.type === ServerMessageType.Error) {
        // A refused reload names the Session and reports why; a failure that names no Session is
        // not this reload's answer, so it leaves the pending text alone.
        if (message.session === undefined || !sessionMatches(active, message.session)) {
          return;
        }
        reloadPending = false;
      }
    },
    setNotice(text) {
      clearStrip();
      notice = text;
    },
    noteReload() {
      clearStrip();
      reloadPending = true;
    },
    clearReloadPending() {
      reloadPending = false;
    },
    beginForkPicker() {
      forkMessages = null;
      clearStrip();
    },
    dismissResults() {
      clearStrip();
    },
    clear() {
      active = null;
      discoverable = [];
      stats = null;
      exportedPath = null;
      forkMessages = null;
      notice = null;
      reloadPending = false;
    },
  };
}

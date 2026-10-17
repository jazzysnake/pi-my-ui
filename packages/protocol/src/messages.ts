/**
 * Every message that crosses the WebSocket, defined once. Client and server ship together, so there
 * is no version field and no negotiation.
 */

import { ClientMessageType, ServerMessageType } from "./constants.js";
import type { SessionActivity, StreamingBehavior, ThinkingLevel } from "./constants.js";
import type { DirectoryEntry } from "./files.js";
import type {
  CommandInfo,
  Cursor,
  DeltaBatch,
  ImageAttachment,
  ModelInfo,
  SessionProjection,
  SessionStats,
  SessionSummary,
} from "./model.js";
import type { ProtocolErrorInfo } from "./errors.js";

/** List this server's Sessions. A Session-free capability, so it carries no Session and no Cursor. */
export interface ListSessionsMessage {
  readonly type: typeof ClientMessageType.ListSessions;
}

/** Start a fresh Session. The server generates its id; a client never names one. */
export interface CreateSessionMessage {
  readonly type: typeof ClientMessageType.CreateSession;
}

/** Identify the Session to watch, and the Cursor the browser already holds when it has one. */
export interface SubscribeMessage {
  readonly type: typeof ClientMessageType.Subscribe;
  readonly sessionId: string;
  readonly cursor?: Cursor;
}

/** Send one message to the Session's Pi child, starting or steering its run. */
export interface PromptMessage {
  readonly type: typeof ClientMessageType.Prompt;
  readonly sessionId: string;
  readonly text: string;
  /** Images to send with the message, in the order the composer shows them. */
  readonly images?: readonly ImageAttachment[];
  /**
   * How to deliver the message while a run is active. pi requires one of these to queue during a
   * run and ignores it otherwise, so it is only present when the composer chose one.
   */
  readonly streamingBehavior?: StreamingBehavior;
}

/**
 * Run one shell command in the Session's working directory. `excludeFromContext` is `true` for `!!`,
 * the one boolean that keeps the output out of the model's context on the next prompt.
 */
export interface BashMessage {
  readonly type: typeof ClientMessageType.Bash;
  readonly sessionId: string;
  readonly command: string;
  readonly excludeFromContext: boolean;
}

/** Switch the Session's model. */
export interface SetModelMessage {
  readonly type: typeof ClientMessageType.SetModel;
  readonly sessionId: string;
  readonly provider: string;
  readonly modelId: string;
}

/** Set the Session's reasoning level. */
export interface SetThinkingLevelMessage {
  readonly type: typeof ClientMessageType.SetThinkingLevel;
  readonly sessionId: string;
  readonly level: ThinkingLevel;
}

/** Turn pi's automatic compaction on or off. */
export interface SetAutoCompactionMessage {
  readonly type: typeof ClientMessageType.SetAutoCompaction;
  readonly sessionId: string;
  readonly enabled: boolean;
}

/** Cancel the Session's running turn. */
export interface AbortMessage {
  readonly type: typeof ClientMessageType.Abort;
  readonly sessionId: string;
}

/**
 * List one directory of the server's working directory. `path` is relative to that root; `""` is the
 * root itself. A filesystem read is not Session state, so it carries no Session and no Cursor.
 */
export interface ListDirectoryMessage {
  readonly type: typeof ClientMessageType.ListDirectory;
  readonly path: string;
}

/** Read a bounded text preview of one text-like file, relative to the server's working directory. */
export interface PreviewFileMessage {
  readonly type: typeof ClientMessageType.PreviewFile;
  readonly path: string;
}

/** Read one Session's statistics for the session panel; a read, so it carries no Cursor. */
export interface GetSessionStatsMessage {
  readonly type: typeof ClientMessageType.GetSessionStats;
  readonly sessionId: string;
}

/** Set the Session's display name in pi (`session_info`); the name is never empty. */
export interface SetSessionNameMessage {
  readonly type: typeof ClientMessageType.SetSessionName;
  readonly sessionId: string;
  readonly name: string;
}

/**
 * Export the Session to an HTML file. The client names no path: pi writes its own
 * `pi-session-<basename>.html` inside the served directory and answers the relative path, so the
 * file-download route can serve it and an arbitrary write target is impossible.
 */
export interface ExportSessionMessage {
  readonly type: typeof ClientMessageType.ExportSession;
  readonly sessionId: string;
}

/**
 * Respawn a Session whose Pi child is gone: the server starts a new child from the Session file and
 * sends a fresh Snapshot. A client sends it for a crashed child only; an evicted child is respawned
 * by its next `subscribe`, so opening a Session never needs this message.
 */
export interface ReconnectMessage {
  readonly type: typeof ClientMessageType.Reconnect;
  readonly sessionId: string;
}

export type ClientMessage =
  | ListSessionsMessage
  | CreateSessionMessage
  | SubscribeMessage
  | PromptMessage
  | BashMessage
  | AbortMessage
  | SetModelMessage
  | SetThinkingLevelMessage
  | SetAutoCompactionMessage
  | ListDirectoryMessage
  | PreviewFileMessage
  | GetSessionStatsMessage
  | SetSessionNameMessage
  | ExportSessionMessage
  | ReconnectMessage;

/**
 * Every Session this server can serve, most recently active first. `sessions` stays the disk facts
 * pi wrote; `activity` is the server's live overlay for the Sessions that currently have a child,
 * so a refreshed list cannot overwrite a row's working state with a stale file.
 */
export interface SessionsMessage {
  readonly type: typeof ServerMessageType.Sessions;
  readonly sessions: readonly SessionSummary[];
  readonly activity: Readonly<Record<string, SessionActivity>>;
}

/** The Session a `createSession` request produced, so the client can open it. */
export interface SessionCreatedMessage {
  readonly type: typeof ServerMessageType.SessionCreated;
  readonly sessionId: string;
}

/** A full Projection at a Cursor. */
export interface SnapshotMessage {
  readonly type: typeof ServerMessageType.Snapshot;
  readonly sessionId: string;
  readonly cursor: Cursor;
  readonly projection: SessionProjection;
}

/** A cursor-addressed batch of Deltas. */
export interface DeltaMessage extends DeltaBatch {
  readonly type: typeof ServerMessageType.Delta;
  readonly sessionId: string;
}

/**
 * One Session's settings as pi holds them: the status strip's model, reasoning level and automatic
 * compaction. Settings live beside the Projection rather than inside it because they change without
 * moving the Cursor, and a reconnect re-reads them from pi rather than replaying them.
 */
export interface SettingsMessage {
  readonly type: typeof ServerMessageType.Settings;
  readonly sessionId: string;
  readonly model: ModelInfo | null;
  readonly availableModels: readonly ModelInfo[];
  readonly thinkingLevel: ThinkingLevel;
  readonly availableThinkingLevels: readonly ThinkingLevel[];
  readonly autoCompactionEnabled: boolean;
}

/** A typed failure, carrying the code the client branches on. */
export interface ErrorMessage {
  readonly type: typeof ServerMessageType.Error;
  readonly error: ProtocolErrorInfo;
  /** The Session the failed request named, when it named one; absent for a malformed frame. */
  readonly sessionId?: string;
}

/** One directory's entries, echoing the normalized relative `path` the request named. */
export interface DirectoryListingMessage {
  readonly type: typeof ServerMessageType.DirectoryListing;
  readonly path: string;
  readonly entries: readonly DirectoryEntry[];
}

/** A bounded text preview of one text-like file, with the truncation stated rather than implied. */
export interface FilePreviewMessage {
  readonly type: typeof ServerMessageType.FilePreview;
  readonly path: string;
  readonly text: string;
  /** The file's full size in bytes, so a client can state what the preview left out. */
  readonly size: number;
  readonly truncated: boolean;
}

/** Every command this Session's Pi child offers: prompt templates, skills and extension commands. */
export interface CommandsMessage {
  readonly type: typeof ServerMessageType.Commands;
  readonly sessionId: string;
  readonly commands: readonly CommandInfo[];
}

/** One Session's statistics, answering a {@link GetSessionStatsMessage}. */
export interface SessionStatsMessage {
  readonly type: typeof ServerMessageType.SessionStats;
  readonly sessionId: string;
  readonly stats: SessionStats;
}

/** The relative path of the HTML file pi wrote for an {@link ExportSessionMessage}. */
export interface SessionExportedMessage {
  readonly type: typeof ServerMessageType.SessionExported;
  readonly sessionId: string;
  readonly path: string;
}

/** pi accepted the Session's new display name, so the client can say so without guessing. */
export interface SessionRenamedMessage {
  readonly type: typeof ServerMessageType.SessionRenamed;
  readonly sessionId: string;
  readonly name: string;
}

export type ServerMessage =
  | SessionsMessage
  | SessionCreatedMessage
  | SnapshotMessage
  | DeltaMessage
  | SettingsMessage
  | ErrorMessage
  | DirectoryListingMessage
  | FilePreviewMessage
  | CommandsMessage
  | SessionStatsMessage
  | SessionExportedMessage
  | SessionRenamedMessage;

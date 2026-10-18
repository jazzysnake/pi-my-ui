/**
 * Every message that crosses the WebSocket, defined once. Client and server ship together, so there
 * is no version field and no negotiation.
 */

import { ClientMessageType, ServerMessageType } from "./constants.js";
import type {
  SessionActivity,
  SessionMutation,
  StreamingBehavior,
  ThinkingLevel,
} from "./constants.js";
import type { DirectoryEntry } from "./files.js";
import type {
  CommandInfo,
  ContextUsage,
  Cursor,
  DeltaBatch,
  ForkMessage,
  ImageAttachment,
  ModelInfo,
  SessionProjection,
  SessionRef,
  SessionStats,
  SessionSummary,
  SubagentTranscriptLookup,
} from "./model.js";
import type { ProtocolErrorInfo } from "./errors.js";
import type { SessionTree } from "./tree.js";

/**
 * Ask which Projects this server serves. It reads the launch-time list, so it carries no path, no
 * Session and no Cursor.
 */
export interface ListProjectsMessage {
  readonly type: typeof ClientMessageType.ListProjects;
}

/** List one Project's Sessions. The server answers only what that Project holds. */
export interface ListSessionsMessage {
  readonly type: typeof ClientMessageType.ListSessions;
  readonly project: string;
}

/** Start a fresh Session in one Project. The server generates its id; a client never names one. */
export interface CreateSessionMessage {
  readonly type: typeof ClientMessageType.CreateSession;
  readonly project: string;
}

/** Identify the Session to watch, and the Cursor the browser already holds when it has one. */
export interface SubscribeMessage {
  readonly type: typeof ClientMessageType.Subscribe;
  readonly session: SessionRef;
  readonly cursor?: Cursor;
}

/** Send one message to the Session's Pi child, starting or steering its run. */
export interface PromptMessage {
  readonly type: typeof ClientMessageType.Prompt;
  readonly session: SessionRef;
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

/**
 * Compact the Session now. `customInstructions` is the text typed after `/compact`, which pi appends
 * to its summary prompt as extra focus; absent when the user asked for a plain compaction.
 */
export interface CompactMessage {
  readonly type: typeof ClientMessageType.Compact;
  readonly sessionId: string;
  readonly customInstructions?: string;
}

/** Cancel the Session's running turn. */
export interface AbortMessage {
  readonly type: typeof ClientMessageType.Abort;
  readonly session: SessionRef;
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

/** Read the Session's user messages a fork can start from; a read, so it carries no Cursor. */
export interface GetForkMessagesMessage {
  readonly type: typeof ClientMessageType.GetForkMessages;
  readonly sessionId: string;
}

/**
 * Create a new Session that branches from `entryId`, an earlier user message. pi excludes that
 * message and everything after it, so the original Session keeps the message it was forked from.
 */
export interface ForkSessionMessage {
  readonly type: typeof ClientMessageType.ForkSession;
  readonly sessionId: string;
  readonly entryId: string;
}

/** Copy the Session's active branch into a new Session, leaving the original as it stands. */
export interface CloneSessionMessage {
  readonly type: typeof ClientMessageType.CloneSession;
  readonly sessionId: string;
}

/** Read the Session's message tree, including every branch off the active path. */
export interface GetTreeMessage {
  readonly type: typeof ClientMessageType.GetTree;
  readonly sessionId: string;
}

/**
 * Move the Session's Leaf to an entry that already exists. A user message moves to its parent, which
 * is what makes its text editable and resubmittable; any other entry becomes the Leaf itself.
 */
export interface MoveLeafMessage {
  readonly type: typeof ClientMessageType.MoveLeaf;
  readonly sessionId: string;
  readonly entryId: string;
}

/**
 * Send one message to a running subagent's own conversation. The bridge delivers it as a user turn
 * after the agent's current tool call, so it is a redirection of the run, not a new Session prompt.
 */
export interface SteerSubagentMessage {
  readonly type: typeof ClientMessageType.SteerSubagent;
  readonly sessionId: string;
  /** The agent record's id, as the Projection's `subagents` carry it. */
  readonly agentId: string;
  readonly message: string;
}

/**
 * Ask for one run's own conversation, read from the child session file pi-subagents wrote. Only a
 * run this server did not stream has one to read, so a client asks for the agent it is focusing.
 */
export interface GetSubagentTranscriptMessage {
  readonly type: typeof ClientMessageType.GetSubagentTranscript;
  readonly sessionId: string;
  /** The agent record's id, as the Projection's `subagents` carry it. */
  readonly agentId: string;
}

export type ClientMessage =
  | ListProjectsMessage
  | ListSessionsMessage
  | CreateSessionMessage
  | SubscribeMessage
  | PromptMessage
  | BashMessage
  | AbortMessage
  | SetModelMessage
  | SetThinkingLevelMessage
  | SetAutoCompactionMessage
  | CompactMessage
  | ListDirectoryMessage
  | PreviewFileMessage
  | GetSessionStatsMessage
  | SetSessionNameMessage
  | ExportSessionMessage
  | GetForkMessagesMessage
  | ForkSessionMessage
  | CloneSessionMessage
  | GetTreeMessage
  | MoveLeafMessage
  | SteerSubagentMessage
  | GetSubagentTranscriptMessage
  | ReconnectMessage;

/**
 * The Projects this server serves, as absolute paths in the order the launcher was given them. The
 * order is the owner's, so the client's picker shows the list in the order it was typed.
 */
export interface ProjectsMessage {
  readonly type: typeof ServerMessageType.Projects;
  readonly projects: readonly string[];
}

/**
 * One Project's Sessions, most recently active first. `sessions` stays the disk facts pi wrote;
 * `activity` is the server's live overlay for the Sessions that currently have a child, so a
 * refreshed list cannot overwrite a row's working state with a stale file.
 */
export interface SessionsMessage {
  readonly type: typeof ServerMessageType.Sessions;
  readonly project: string;
  readonly sessions: readonly SessionSummary[];
  readonly activity: Readonly<Record<string, SessionActivity>>;
}

/** The Session a `createSession` request produced, so the client can open it. */
export interface SessionCreatedMessage {
  readonly type: typeof ServerMessageType.SessionCreated;
  readonly session: SessionRef;
}

/** A full Projection at a Cursor. */
export interface SnapshotMessage {
  readonly type: typeof ServerMessageType.Snapshot;
  readonly session: SessionRef;
  readonly cursor: Cursor;
  readonly projection: SessionProjection;
}

/** A cursor-addressed batch of Deltas. */
export interface DeltaMessage extends DeltaBatch {
  readonly type: typeof ServerMessageType.Delta;
  readonly session: SessionRef;
}

/**
 * One Session's settings as pi holds them: the status strip's model, reasoning level and automatic
 * compaction. Settings live beside the Projection rather than inside it because they change without
 * moving the Cursor, and a reconnect re-reads them from pi rather than replaying them.
 */
export interface SettingsMessage {
  readonly type: typeof ServerMessageType.Settings;
  readonly session: SessionRef;
  readonly model: ModelInfo | null;
  readonly availableModels: readonly ModelInfo[];
  readonly thinkingLevel: ThinkingLevel;
  readonly availableThinkingLevels: readonly ThinkingLevel[];
  readonly autoCompactionEnabled: boolean;
}

/**
 * One Session's context-window usage as pi measures it. It is read rather than replayed, like the
 * Settings beside it: pi pushes no event for it, and a reconnect re-reads the current figure instead
 * of replaying every change it missed. `null` means pi has no figure at all (no model or window).
 */
export interface ContextUsageMessage {
  readonly type: typeof ServerMessageType.ContextUsage;
  readonly session: SessionRef;
  readonly contextUsage: ContextUsage | null;
}

/** A typed failure, carrying the code the client branches on. */
export interface ErrorMessage {
  readonly type: typeof ServerMessageType.Error;
  readonly error: ProtocolErrorInfo;
  /** The Session the failed request named, when it named one; absent for a malformed frame. */
  readonly session?: SessionRef;
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
  readonly session: SessionRef;
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

/** The user messages a fork can start from, answering a {@link GetForkMessagesMessage}. */
export interface ForkMessagesMessage {
  readonly type: typeof ServerMessageType.ForkMessages;
  readonly sessionId: string;
  readonly messages: readonly ForkMessage[];
}

/**
 * A fork or clone ran. `sessionId` is the Session it created, absent when an extension vetoed the
 * mutation before it happened: a veto is neither a new Session nor a failure.
 */
export interface SessionForkedMessage {
  readonly type: typeof ServerMessageType.SessionForked;
  readonly sourceSessionId: string;
  readonly mutation: SessionMutation;
  readonly sessionId?: string;
}

/** One Session's message tree, answering a {@link GetTreeMessage}. */
export interface SessionTreeMessage {
  readonly type: typeof ServerMessageType.SessionTree;
  readonly sessionId: string;
  readonly tree: SessionTree;
}

/**
 * pi confirmed a Leaf move. `entryId` is the entry the client selected; `leafId` is the Leaf pi left
 * the Session on, which is not the same entry for a user message.
 */
export interface LeafMovedMessage {
  readonly type: typeof ServerMessageType.LeafMoved;
  readonly sessionId: string;
  readonly entryId: string;
  readonly leafId: string | null;
}

/**
 * One settled run's conversation as its own session file holds it. `kind` says what the file held:
 * the projected entries, nothing, or why it could not be opened.
 */
export type SubagentTranscriptMessage = SubagentTranscriptLookup & {
  readonly type: typeof ServerMessageType.SubagentTranscript;
  readonly sessionId: string;
  readonly agentId: string;
};

export type ServerMessage =
  | ProjectsMessage
  | SessionsMessage
  | SessionCreatedMessage
  | SnapshotMessage
  | DeltaMessage
  | SettingsMessage
  | ContextUsageMessage
  | ErrorMessage
  | DirectoryListingMessage
  | FilePreviewMessage
  | CommandsMessage
  | SessionStatsMessage
  | SessionExportedMessage
  | SessionRenamedMessage
  | ForkMessagesMessage
  | SessionForkedMessage
  | SessionTreeMessage
  | LeafMovedMessage
  | SubagentTranscriptMessage;

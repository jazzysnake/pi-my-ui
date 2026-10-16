/**
 * Every message that crosses the WebSocket, defined once. Client and server ship together, so there
 * is no version field and no negotiation.
 */

import { ClientMessageType, ServerMessageType } from "./constants.js";
import type { DirectoryEntry } from "./files.js";
import type { Cursor, DeltaBatch, SessionProjection } from "./model.js";
import type { ProtocolErrorInfo } from "./errors.js";

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

export type ClientMessage =
  SubscribeMessage | PromptMessage | AbortMessage | ListDirectoryMessage | PreviewFileMessage;

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

/** A typed failure, carrying the code the client branches on. */
export interface ErrorMessage {
  readonly type: typeof ServerMessageType.Error;
  readonly error: ProtocolErrorInfo;
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

export type ServerMessage =
  SnapshotMessage | DeltaMessage | ErrorMessage | DirectoryListingMessage | FilePreviewMessage;

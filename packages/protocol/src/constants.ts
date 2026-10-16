/**
 * Every discriminant in the client↔server contract, defined once and compared through these
 * constants. The server and the client import them, so a spelling can never drift between the ends.
 */

/** Discriminants for every client→server message. */
export const ClientMessageType = {
  Subscribe: "subscribe",
  Prompt: "prompt",
  Abort: "abort",
  ListDirectory: "listDirectory",
  PreviewFile: "previewFile",
} as const;

export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

/** Discriminants for every server→client message. */
export const ServerMessageType = {
  Snapshot: "snapshot",
  Delta: "delta",
  Error: "error",
  DirectoryListing: "directoryListing",
  FilePreview: "filePreview",
} as const;

export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

/** Discriminants for one change to a Projection. */
export const ProjectionDeltaKind = {
  EntryUpsert: "entryUpsert",
  EntryRemoved: "entryRemoved",
  LeafChanged: "leafChanged",
  RunState: "runState",
} as const;

/** The states a Session's run can be in, as the transcript shows them. */
export const RunStateKind = {
  Idle: "idle",
  Streaming: "streaming",
  Retrying: "retrying",
  Aborted: "aborted",
  Errored: "errored",
} as const;

export type RunStateKind = (typeof RunStateKind)[keyof typeof RunStateKind];

export type ProjectionDeltaKind = (typeof ProjectionDeltaKind)[keyof typeof ProjectionDeltaKind];

/** The role a projected message plays in a transcript. */
export const MessageRole = {
  User: "user",
  Assistant: "assistant",
  ToolResult: "toolResult",
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

/** The kind of a directory entry, as a listing reports it. */
export const FileEntryType = {
  File: "file",
  Directory: "directory",
  Symlink: "symlink",
  Other: "other",
} as const;

export type FileEntryType = (typeof FileEntryType)[keyof typeof FileEntryType];

/** Discriminants for a projected content block. */
export const ContentBlockType = {
  Text: "text",
  Reasoning: "reasoning",
  ToolCall: "toolCall",
} as const;

export type ContentBlockType = (typeof ContentBlockType)[keyof typeof ContentBlockType];

/**
 * Every discriminant in the client↔server contract, defined once and compared through these
 * constants. The server and the client import them, so a spelling can never drift between the ends.
 */

/** Discriminants for every client→server message. */
export const ClientMessageType = {
  ListSessions: "listSessions",
  CreateSession: "createSession",
  Subscribe: "subscribe",
  Prompt: "prompt",
  Abort: "abort",
  SetModel: "setModel",
  SetThinkingLevel: "setThinkingLevel",
  SetAutoCompaction: "setAutoCompaction",
  Compact: "compact",
  ListDirectory: "listDirectory",
  PreviewFile: "previewFile",
  GetSessionStats: "getSessionStats",
  SetSessionName: "setSessionName",
  ExportSession: "exportSession",
  GetForkMessages: "getForkMessages",
  ForkSession: "forkSession",
  CloneSession: "cloneSession",
  Bash: "bash",
  Reconnect: "reconnect",
  GetTree: "getTree",
  MoveLeaf: "moveLeaf",
  SteerSubagent: "steerSubagent",
  GetSubagentTranscript: "getSubagentTranscript",
} as const;

export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

/** Discriminants for every server→client message. */
export const ServerMessageType = {
  Sessions: "sessions",
  SessionCreated: "sessionCreated",
  Snapshot: "snapshot",
  Delta: "delta",
  Settings: "settings",
  ContextUsage: "contextUsage",
  Error: "error",
  DirectoryListing: "directoryListing",
  FilePreview: "filePreview",
  Commands: "commands",
  SessionStats: "sessionStats",
  SessionExported: "sessionExported",
  SessionRenamed: "sessionRenamed",
  ForkMessages: "forkMessages",
  SessionForked: "sessionForked",
  SessionTree: "sessionTree",
  LeafMoved: "leafMoved",
  SubagentTranscript: "subagentTranscript",
} as const;

export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

/** Discriminants for one change to a Projection. */
export const ProjectionDeltaKind = {
  EntryUpsert: "entryUpsert",
  EntryRemoved: "entryRemoved",
  LeafChanged: "leafChanged",
  RunState: "runState",
  SubagentUpsert: "subagentUpsert",
  SubagentEntryUpsert: "subagentEntryUpsert",
  SubagentEntryRemoved: "subagentEntryRemoved",
} as const;

/** The states a Session's run can be in, as the transcript shows them. */
export const RunStateKind = {
  Idle: "idle",
  Streaming: "streaming",
  /** pi is summarizing the conversation into a compaction boundary. */
  Compacting: "compacting",
  Retrying: "retrying",
  Aborted: "aborted",
  Errored: "errored",
  Crashed: "crashed",
} as const;

export type RunStateKind = (typeof RunStateKind)[keyof typeof RunStateKind];

/**
 * The coarse working state a Session list row shows. A Session is working when its run is streaming
 * or retrying; every other run state reads as idle, so the row has one closed signal rather than a
 * per-state mapping that would drift from the run-state set.
 */
export const SessionActivity = {
  Idle: "idle",
  Working: "working",
} as const;

export type SessionActivity = (typeof SessionActivity)[keyof typeof SessionActivity];

export type ProjectionDeltaKind = (typeof ProjectionDeltaKind)[keyof typeof ProjectionDeltaKind];

/** What kind of row an entry is in the transcript. */
export const EntryKind = {
  /** One message, with the role it played. */
  Message: "message",
  /** The marker pi's compaction left where history became a summary. */
  CompactionBoundary: "compactionBoundary",
} as const;

export type EntryKind = (typeof EntryKind)[keyof typeof EntryKind];

/** The role a projected message plays in a transcript. */
export const MessageRole = {
  User: "user",
  Assistant: "assistant",
  ToolResult: "toolResult",
  /** An extension-injected message (pi's `custom` role), rendered as a notification card. */
  Notification: "notification",
  /** A direct shell command (pi's `bashExecution` role), rendered as a bash card. */
  Bash: "bash",
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
  BashExecution: "bashExecution",
  Error: "error",
} as const;

export type ContentBlockType = (typeof ContentBlockType)[keyof typeof ContentBlockType];

/** The lifecycle states a tool call shows as a card. */
export const ToolCallStatus = {
  Running: "running",
  Success: "success",
  Error: "error",
} as const;

export type ToolCallStatus = (typeof ToolCallStatus)[keyof typeof ToolCallStatus];

/**
 * How a message submitted during an active run reaches pi: `steer` interrupts at the next step, and
 * `followUp` waits until the run finishes. The spellings are pi's own RPC values.
 */
export const StreamingBehavior = {
  Steer: "steer",
  FollowUp: "followUp",
} as const;

export type StreamingBehavior = (typeof StreamingBehavior)[keyof typeof StreamingBehavior];

/**
 * What kind of resource registered a discoverable command. These are pi's own source values, so the
 * palette's badge is pi's vocabulary rather than a second spelling that can drift.
 */
export const CommandSource = {
  Extension: "extension",
  Prompt: "prompt",
  Skill: "skill",
} as const;

export type CommandSource = (typeof CommandSource)[keyof typeof CommandSource];

/**
 * The two mutations that make a new Session out of an existing one: a fork branches from an earlier
 * user message, a clone copies the active branch. The spellings are pi's own commands.
 */
export const SessionMutation = {
  Fork: "fork",
  Clone: "clone",
} as const;

export type SessionMutation = (typeof SessionMutation)[keyof typeof SessionMutation];

/** pi's reasoning levels; `off` disables it. */
export const ThinkingLevel = {
  Off: "off",
  Minimal: "minimal",
  Low: "low",
  Medium: "medium",
  High: "high",
  XHigh: "xhigh",
  Max: "max",
} as const;

export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];

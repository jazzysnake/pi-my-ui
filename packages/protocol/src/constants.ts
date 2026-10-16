/**
 * Every discriminant in the client↔server contract, defined once and compared through these
 * constants. The server and the client import them, so a spelling can never drift between the ends.
 */

/** Discriminants for every client→server message. */
export const ClientMessageType = {
  Subscribe: "subscribe",
} as const;

export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

/** Discriminants for every server→client message. */
export const ServerMessageType = {
  Snapshot: "snapshot",
  Delta: "delta",
  Error: "error",
} as const;

export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

/** Discriminants for one change to a Projection. */
export const ProjectionDeltaKind = {
  EntryUpsert: "entryUpsert",
  EntryRemoved: "entryRemoved",
  LeafChanged: "leafChanged",
} as const;

export type ProjectionDeltaKind = (typeof ProjectionDeltaKind)[keyof typeof ProjectionDeltaKind];

/** The role a projected message plays in a transcript. */
export const MessageRole = {
  User: "user",
  Assistant: "assistant",
  ToolResult: "toolResult",
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

/** Discriminants for a projected content block. */
export const ContentBlockType = {
  Text: "text",
  Reasoning: "reasoning",
  ToolCall: "toolCall",
} as const;

export type ContentBlockType = (typeof ContentBlockType)[keyof typeof ContentBlockType];

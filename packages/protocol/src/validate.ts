/**
 * Runtime validation of every inbound client message. A message is either returned as a typed value
 * or the parse throws a {@link ProtocolError}; nothing is coerced, defaulted or partly accepted.
 */

import { ClientMessageType } from "./constants.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";
import type { Cursor } from "./model.js";
import type {
  ClientMessage,
  ListDirectoryMessage,
  PreviewFileMessage,
  PromptMessage,
  SubscribeMessage,
} from "./messages.js";

function malformed(message: string): never {
  throw new ProtocolError(ProtocolErrorCode.MalformedPayload, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    malformed("a client message must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireSessionId(record: Record<string, unknown>): string {
  const sessionId = record["sessionId"];
  if (typeof sessionId !== "string" || sessionId === "") {
    malformed('"sessionId" must be a non-empty string');
  }
  return sessionId;
}

function optionalCursor(record: Record<string, unknown>): Cursor | undefined {
  const cursor = record["cursor"];
  if (cursor === undefined) {
    return undefined;
  }
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) {
    malformed('"cursor" must be a non-negative safe integer when present');
  }
  return cursor;
}

function validateSubscribe(record: Record<string, unknown>): SubscribeMessage {
  const cursor = optionalCursor(record);
  const sessionId = requireSessionId(record);
  return cursor === undefined
    ? { type: ClientMessageType.Subscribe, sessionId }
    : { type: ClientMessageType.Subscribe, sessionId, cursor };
}

function requireText(record: Record<string, unknown>): string {
  const text = record["text"];
  if (typeof text !== "string" || text === "") {
    malformed('"text" must be a non-empty string');
  }
  return text;
}

/** A path relative to the server root. Empty means the root itself, so only the type is checked. */
function requirePath(record: Record<string, unknown>): string {
  const path = record["path"];
  if (typeof path !== "string") {
    malformed('"path" must be a string');
  }
  return path;
}

function validateListDirectory(record: Record<string, unknown>): ListDirectoryMessage {
  return { type: ClientMessageType.ListDirectory, path: requirePath(record) };
}

function validatePreviewFile(record: Record<string, unknown>): PreviewFileMessage {
  return { type: ClientMessageType.PreviewFile, path: requirePath(record) };
}

function validatePrompt(record: Record<string, unknown>): PromptMessage {
  return {
    type: ClientMessageType.Prompt,
    sessionId: requireSessionId(record),
    text: requireText(record),
  };
}

/** Parse one already-decoded client message, or throw a typed {@link ProtocolError}. */
export function validateClientMessage(value: unknown): ClientMessage {
  const record = asRecord(value);
  const type = record["type"];
  if (typeof type !== "string") {
    malformed('"type" must be a string');
  }
  switch (type) {
    case ClientMessageType.Subscribe:
      return validateSubscribe(record);
    case ClientMessageType.Prompt:
      return validatePrompt(record);
    case ClientMessageType.Abort:
      return { type: ClientMessageType.Abort, sessionId: requireSessionId(record) };
    case ClientMessageType.ListDirectory:
      return validateListDirectory(record);
    case ClientMessageType.PreviewFile:
      return validatePreviewFile(record);
    default:
      throw new ProtocolError(
        ProtocolErrorCode.UnknownType,
        `unknown client message type ${JSON.stringify(type)}`,
      );
  }
}

/** Parse the text of one WebSocket frame, or throw a typed {@link ProtocolError}. */
export function parseClientMessage(text: string): ClientMessage {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    malformed(`a client message must be valid JSON (${detail})`);
  }
  return validateClientMessage(decoded);
}

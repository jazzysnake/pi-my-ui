/**
 * Runtime validation of every inbound client message. A message is either returned as a typed value
 * or the parse throws a {@link ProtocolError}; nothing is coerced, defaulted or partly accepted.
 */

import { ClientMessageType, StreamingBehavior, ThinkingLevel } from "./constants.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BASE64_LENGTH_CHARS,
  MAX_IMAGES_PER_MESSAGE,
} from "./images.js";
import type { Cursor, ImageAttachment } from "./model.js";
import type {
  ClientMessage,
  ExportSessionMessage,
  GetSessionStatsMessage,
  ListDirectoryMessage,
  PreviewFileMessage,
  PromptMessage,
  SetAutoCompactionMessage,
  SetModelMessage,
  SetSessionNameMessage,
  SetThinkingLevelMessage,
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
  const images = optionalImages(record);
  const behavior = optionalStreamingBehavior(record);
  return {
    type: ClientMessageType.Prompt,
    sessionId: requireSessionId(record),
    // Text may be empty when the message carries an image; otherwise a blank message is refused.
    text: requirePromptText(record, images),
    ...(images === undefined ? {} : { images }),
    ...(behavior === undefined ? {} : { streamingBehavior: behavior }),
  };
}

function requirePromptText(
  record: Record<string, unknown>,
  images: readonly ImageAttachment[] | undefined,
): string {
  const text = record["text"];
  if (typeof text !== "string") {
    malformed('"text" must be a string');
  }
  if (text === "" && (images === undefined || images.length === 0)) {
    malformed('"text" must be a non-empty string when no images are attached');
  }
  return text;
}

/** One image, or a loud failure naming the offending field. */
function requireImage(value: unknown, index: number): ImageAttachment {
  const where = `"images[${String(index)}]"`;
  const record = asRecord(value);
  const mediaType = record["mediaType"];
  const data = record["data"];
  if (
    typeof mediaType !== "string" ||
    !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mediaType)
  ) {
    malformed(`${where}.mediaType must be one of ${ALLOWED_IMAGE_MIME_TYPES.join(", ")}`);
  }
  if (typeof data !== "string" || data === "") {
    malformed(`${where}.data must be a non-empty base64 string`);
  }
  if (data.length > MAX_IMAGE_BASE64_LENGTH_CHARS) {
    malformed(`${where}.data exceeds the maximum image size`);
  }
  return { mediaType, data };
}

function optionalImages(record: Record<string, unknown>): readonly ImageAttachment[] | undefined {
  const images = record["images"];
  if (images === undefined) {
    return undefined;
  }
  if (!Array.isArray(images)) {
    malformed('"images" must be an array when present');
  }
  if (images.length > MAX_IMAGES_PER_MESSAGE) {
    malformed(`"images" carries at most ${String(MAX_IMAGES_PER_MESSAGE)} images`);
  }
  return images.map((image, index) => requireImage(image, index));
}

const THINKING_LEVELS: readonly string[] = Object.values(ThinkingLevel);
const STREAMING_BEHAVIORS: readonly string[] = Object.values(StreamingBehavior);

function optionalStreamingBehavior(record: Record<string, unknown>): StreamingBehavior | undefined {
  const value = record["streamingBehavior"];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !STREAMING_BEHAVIORS.includes(value)) {
    malformed(`"streamingBehavior" must be one of ${STREAMING_BEHAVIORS.join(", ")}`);
  }
  return value as StreamingBehavior;
}

function validateSetModel(record: Record<string, unknown>): SetModelMessage {
  const provider = record["provider"];
  const modelId = record["modelId"];
  if (typeof provider !== "string" || provider === "") {
    malformed('"provider" must be a non-empty string');
  }
  if (typeof modelId !== "string" || modelId === "") {
    malformed('"modelId" must be a non-empty string');
  }
  return {
    type: ClientMessageType.SetModel,
    sessionId: requireSessionId(record),
    provider,
    modelId,
  };
}

function validateSetThinkingLevel(record: Record<string, unknown>): SetThinkingLevelMessage {
  const level = record["level"];
  if (typeof level !== "string" || !THINKING_LEVELS.includes(level)) {
    malformed(`"level" must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  return {
    type: ClientMessageType.SetThinkingLevel,
    sessionId: requireSessionId(record),
    level: level as ThinkingLevel,
  };
}

function validateSetAutoCompaction(record: Record<string, unknown>): SetAutoCompactionMessage {
  const enabled = record["enabled"];
  if (typeof enabled !== "boolean") {
    malformed('"enabled" must be a boolean');
  }
  return {
    type: ClientMessageType.SetAutoCompaction,
    sessionId: requireSessionId(record),
    enabled,
  };
}

function validateGetSessionStats(record: Record<string, unknown>): GetSessionStatsMessage {
  return { type: ClientMessageType.GetSessionStats, sessionId: requireSessionId(record) };
}

function validateSetSessionName(record: Record<string, unknown>): SetSessionNameMessage {
  const name = record["name"];
  if (typeof name !== "string" || name.trim() === "") {
    malformed('"name" must be a non-empty string');
  }
  return { type: ClientMessageType.SetSessionName, sessionId: requireSessionId(record), name };
}

function validateExportSession(record: Record<string, unknown>): ExportSessionMessage {
  return { type: ClientMessageType.ExportSession, sessionId: requireSessionId(record) };
}

/** Parse one already-decoded client message, or throw a typed {@link ProtocolError}. */
export function validateClientMessage(value: unknown): ClientMessage {
  const record = asRecord(value);
  const type = record["type"];
  if (typeof type !== "string") {
    malformed('"type" must be a string');
  }
  switch (type) {
    case ClientMessageType.ListSessions:
      return { type: ClientMessageType.ListSessions };
    case ClientMessageType.CreateSession:
      return { type: ClientMessageType.CreateSession };
    case ClientMessageType.Subscribe:
      return validateSubscribe(record);
    case ClientMessageType.Prompt:
      return validatePrompt(record);
    case ClientMessageType.Abort:
      return { type: ClientMessageType.Abort, sessionId: requireSessionId(record) };
    case ClientMessageType.SetModel:
      return validateSetModel(record);
    case ClientMessageType.SetThinkingLevel:
      return validateSetThinkingLevel(record);
    case ClientMessageType.SetAutoCompaction:
      return validateSetAutoCompaction(record);
    case ClientMessageType.ListDirectory:
      return validateListDirectory(record);
    case ClientMessageType.PreviewFile:
      return validatePreviewFile(record);
    case ClientMessageType.GetSessionStats:
      return validateGetSessionStats(record);
    case ClientMessageType.SetSessionName:
      return validateSetSessionName(record);
    case ClientMessageType.ExportSession:
      return validateExportSession(record);
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

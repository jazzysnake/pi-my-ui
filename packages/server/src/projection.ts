/**
 * Turn one Session's entries into the Delta batch that produces its Projection. The batch runs
 * through the shared reducer, so the Snapshot a browser receives is built the same way the browser
 * would rebuild it from Deltas.
 */

import {
  ContentBlockType,
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  ToolCallStatus,
  type BashExecutionBlock,
  type CompactionBoundaryEntry,
  type ContentBlock,
  type DeltaBatch,
  type ProjectedEntry,
  type ProjectionDelta,
} from "@pi-my-ui/protocol";
import type {
  CompactionEntry,
  CustomMessageEntry,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

type AgentMessage = SessionMessageEntry["message"];
type BashMessage = Extract<AgentMessage, { readonly role: "bashExecution" }>;

/** What a tool result contributes to its call's card. */
export interface ToolResultInfo {
  readonly output: string;
  readonly isError: boolean;
}

/** Resolves a tool-call id to the result that completed it, when the active path carries one. */
export type ToolResultLookup = (toolCallId: string) => ToolResultInfo | undefined;

export interface ProjectionSource {
  readonly entries: readonly SessionEntry[];
  readonly leafId: string | null;
  readonly fromCursor: number;
}

/**
 * The entries from the root to the Leaf, in order. Off-path entries are still in `entries`; a
 * transcript is one path through the tree, so the walk from the Leaf selects it.
 */
function activePath(entries: readonly SessionEntry[], leafId: string | null): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reversed: SessionEntry[] = [];
  const seen = new Set<string>();
  let current = leafId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const entry = byId.get(current);
    if (entry === undefined) {
      break;
    }
    reversed.push(entry);
    current = entry.parentId;
  }
  return reversed.reverse();
}

/** The tool results a path carries for calls it declares, keyed by the call that produced them. */
export function toolResultLookup(
  entries: readonly SessionEntry[],
): ReadonlyMap<string, ToolResultInfo> {
  const calls = declaredToolCallIds(entries);
  const results = new Map<string, ToolResultInfo>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "toolResult") {
      continue;
    }
    // A result whose call is absent (an abandoned branch) has no card to fold into.
    if (!calls.has(entry.message.toolCallId)) {
      continue;
    }
    results.set(entry.message.toolCallId, {
      output: toolResultOutput(entry.message),
      isError: entry.message.isError,
    });
  }
  return results;
}

/** Every tool-call id the path's assistant messages declare. */
function declaredToolCallIds(entries: readonly SessionEntry[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    const content = entry.message.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (block.type === ContentBlockType.ToolCall) {
        ids.add(block.id);
      }
    }
  }
  return ids;
}

/** A tool result's visible text, flattened from its content blocks. */
export function toolResultOutput(message: ToolResultMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === ContentBlockType.Text) {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function toolCallStatus(result: ToolResultInfo | undefined): ToolCallStatus {
  if (result === undefined) {
    return ToolCallStatus.Running;
  }
  return result.isError ? ToolCallStatus.Error : ToolCallStatus.Success;
}

/** The failure text the Projection states when pi recorded an error without one. */
export const RUN_FAILED_TEXT = "the run failed";

/**
 * The failure text both the durable error block and the live run-state row state. pi can record an
 * attempt as failed with no error text, or with one that is only whitespace; an error block holding
 * either would look like an empty message, so both fall back to the one failure sentence.
 */
export function failureText(errorMessage: string | undefined): string {
  return errorMessage === undefined || errorMessage.trim() === "" ? RUN_FAILED_TEXT : errorMessage;
}

/**
 * pi's record of an attempt that ended in error: its own error text, after whatever content the
 * attempt produced. Both readers project a failure through this one rule, so neither can drift.
 */
function errorBlockOf(message: AgentMessage): ContentBlock | undefined {
  return "stopReason" in message && message.stopReason === "error"
    ? { type: ContentBlockType.Error, text: failureText(message.errorMessage) }
    : undefined;
}

export function blocksFromMessage(
  message: AgentMessage,
  lookup?: ToolResultLookup,
): ContentBlock[] {
  // Assistant, user, toolResult and custom messages carry content; the state-only message kinds do
  // not, and they have no transcript row.
  if (!("content" in message)) {
    return [];
  }
  const blocks: ContentBlock[] = [];
  if (typeof message.content === "string") {
    if (message.content !== "") {
      blocks.push({ type: ContentBlockType.Text, text: message.content });
    }
  } else {
    for (const block of message.content) {
      if (block.type === ContentBlockType.Text) {
        blocks.push({ type: ContentBlockType.Text, text: block.text });
      } else if (block.type === "thinking") {
        blocks.push({ type: ContentBlockType.Reasoning, text: block.thinking });
      } else if (block.type === ContentBlockType.ToolCall) {
        const result = lookup?.(block.id);
        blocks.push({
          type: ContentBlockType.ToolCall,
          id: block.id,
          name: block.name,
          arguments: block.arguments,
          status: toolCallStatus(result),
          ...(result === undefined || result.output === "" ? {} : { output: result.output }),
        });
      }
    }
  }
  const failure = errorBlockOf(message);
  if (failure !== undefined) {
    blocks.push(failure);
  }
  return blocks;
}

/** How a message's role maps to the transcript; roles with no row return `undefined`. */
export function roleOf(message: AgentMessage): MessageRole | undefined {
  switch (message.role) {
    case "user":
      return MessageRole.User;
    case "assistant":
      return MessageRole.Assistant;
    case "toolResult":
      return MessageRole.ToolResult;
    case "bashExecution":
      return MessageRole.Bash;
    case "custom":
      return message.display === false ? undefined : MessageRole.Notification;
    default:
      return undefined;
  }
}

/** A durable shell command is always finished, so its card carries pi's result, not a live state. */
function bashBlock(entryId: string, message: BashMessage): BashExecutionBlock {
  return {
    type: ContentBlockType.BashExecution,
    commandId: entryId,
    command: message.command,
    excludeFromContext: message.excludeFromContext === true,
    output: message.output,
    result: {
      exitCode: message.exitCode ?? null,
      cancelled: message.cancelled,
      truncated: message.truncated,
      ...(message.fullOutputPath === undefined ? {} : { fullOutputPath: message.fullOutputPath }),
    },
  };
}

function projectMessage(
  entry: SessionMessageEntry,
  lookup: ToolResultLookup,
): ProjectedEntry | undefined {
  const message = entry.message;
  if (message.role === "bashExecution") {
    return {
      kind: EntryKind.Message,
      id: entry.id,
      parentId: entry.parentId,
      role: MessageRole.Bash,
      timestamp: Date.parse(entry.timestamp),
      blocks: [bashBlock(entry.id, message)],
    };
  }
  const role = roleOf(message);
  if (role === undefined) {
    return undefined;
  }
  const blocks = blocksFromMessage(message, lookup);
  // A cancelled attempt pi recorded with no content has nothing to show. The live path removes its
  // placeholder, and a reseed must not resurrect it as a blank row.
  if (blocks.length === 0) {
    return undefined;
  }
  return {
    kind: EntryKind.Message,
    id: entry.id,
    parentId: entry.parentId,
    role,
    timestamp: Date.parse(entry.timestamp),
    blocks,
  };
}

/** An extension message's content is its payload text; image blocks are not part of a transcript. */
function customMessageBlocks(content: CustomMessageEntry["content"]): ContentBlock[] {
  if (typeof content === "string") {
    return content === "" ? [] : [{ type: ContentBlockType.Text, text: content }];
  }
  const blocks: ContentBlock[] = [];
  for (const block of content) {
    if (block.type === ContentBlockType.Text) {
      blocks.push({ type: ContentBlockType.Text, text: block.text });
    }
  }
  return blocks;
}

function projectCustomMessage(entry: CustomMessageEntry): ProjectedEntry | undefined {
  // pi hides a `display: false` custom message in its own UI, so the transcript leaves it out too.
  if (entry.display === false) {
    return undefined;
  }
  const blocks = customMessageBlocks(entry.content);
  if (blocks.length === 0) {
    return undefined;
  }
  return {
    kind: EntryKind.Message,
    id: entry.id,
    parentId: entry.parentId,
    role: MessageRole.Notification,
    timestamp: Date.parse(entry.timestamp),
    blocks,
  };
}

/** A compaction pi persisted, as the boundary the transcript marks history with. */
export function compactionBoundary(entry: CompactionEntry): CompactionBoundaryEntry {
  return {
    kind: EntryKind.CompactionBoundary,
    id: entry.id,
    parentId: entry.parentId,
    timestamp: Date.parse(entry.timestamp),
    summary: entry.summary,
    tokensBefore: entry.tokensBefore,
    firstKeptEntryId: entry.firstKeptEntryId,
  };
}

function projectEntry(entry: SessionEntry, lookup: ToolResultLookup): ProjectedEntry | undefined {
  if (entry.type === "message") {
    // A result is folded into the card that produced it, so it is not also its own row.
    if (entry.message.role === "toolResult" && lookup(entry.message.toolCallId) !== undefined) {
      return undefined;
    }
    return projectMessage(entry, lookup);
  }
  if (entry.type === "custom_message") {
    return projectCustomMessage(entry);
  }
  if (entry.type === "compaction") {
    return compactionBoundary(entry);
  }
  return undefined;
}

/** The batch that takes an empty Projection to this Session's current one. */
export function projectionBatch(source: ProjectionSource): DeltaBatch {
  const path = activePath(source.entries, source.leafId);
  const results = toolResultLookup(path);
  const lookup: ToolResultLookup = (toolCallId) => results.get(toolCallId);
  const deltas: ProjectionDelta[] = [];
  for (const entry of path) {
    const projected = projectEntry(entry, lookup);
    if (projected === undefined) {
      continue;
    }
    deltas.push({ kind: ProjectionDeltaKind.EntryUpsert, entry: projected });
  }
  deltas.push({ kind: ProjectionDeltaKind.LeafChanged, leafId: source.leafId });
  return {
    fromCursor: source.fromCursor,
    cursor: source.fromCursor + deltas.length,
    deltas,
  };
}

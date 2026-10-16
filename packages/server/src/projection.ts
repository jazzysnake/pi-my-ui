/**
 * Turn one Session's entries into the Delta batch that produces its Projection. The batch runs
 * through the shared reducer, so the Snapshot a browser receives is built the same way the browser
 * would rebuild it from Deltas.
 */

import {
  ContentBlockType,
  MessageRole,
  ProjectionDeltaKind,
  type ContentBlock,
  type DeltaBatch,
  type ProjectedEntry,
  type ProjectionDelta,
} from "@pi-my-ui/protocol";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

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

function blocksFrom(message: SessionMessageEntry["message"]): ContentBlock[] {
  // Assistant, user, toolResult and custom messages carry content; the state-only message kinds do
  // not, and they have no transcript row.
  if (!("content" in message)) {
    return [];
  }
  if (typeof message.content === "string") {
    return message.content === "" ? [] : [{ type: ContentBlockType.Text, text: message.content }];
  }
  const blocks: ContentBlock[] = [];
  for (const block of message.content) {
    if (block.type === ContentBlockType.Text) {
      blocks.push({ type: ContentBlockType.Text, text: block.text });
    } else if (block.type === "thinking") {
      blocks.push({ type: ContentBlockType.Reasoning, text: block.thinking });
    } else if (block.type === ContentBlockType.ToolCall) {
      blocks.push({
        type: ContentBlockType.ToolCall,
        id: block.id,
        name: block.name,
        arguments: block.arguments,
      });
    }
  }
  return blocks;
}

function projectMessage(entry: SessionMessageEntry): ProjectedEntry | undefined {
  const role =
    entry.message.role === "user"
      ? MessageRole.User
      : entry.message.role === "assistant"
        ? MessageRole.Assistant
        : entry.message.role === "toolResult"
          ? MessageRole.ToolResult
          : undefined;
  if (role === undefined) {
    return undefined;
  }
  return {
    id: entry.id,
    parentId: entry.parentId,
    role,
    timestamp: Date.parse(entry.timestamp),
    blocks: blocksFrom(entry.message),
  };
}

/** The batch that takes an empty Projection to this Session's current one. */
export function projectionBatch(source: ProjectionSource): DeltaBatch {
  const deltas: ProjectionDelta[] = [];
  for (const entry of activePath(source.entries, source.leafId)) {
    if (entry.type !== "message") {
      continue;
    }
    const projected = projectMessage(entry);
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

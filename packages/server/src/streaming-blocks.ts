/**
 * Block edits for a message that is still streaming: pi reports content by index, and a partial
 * update may name an index the assistant turn has not produced a block for yet. Those gaps are
 * filled with empty text so a later block's index addresses the right slot.
 */

import { ContentBlockType, ToolCallStatus, type ContentBlock } from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

export function setBlock(
  blocks: readonly ContentBlock[],
  index: number,
  block: ContentBlock,
): readonly ContentBlock[] {
  const next = [...blocks];
  while (next.length < index) {
    next.push({ type: ContentBlockType.Text, text: "" });
  }
  next[index] = block;
  return next;
}

/** Append a text or reasoning delta to the block at `index`, starting that block when it is new. */
export function appendBlock(
  blocks: readonly ContentBlock[],
  index: number,
  type: typeof ContentBlockType.Text | typeof ContentBlockType.Reasoning,
  delta: string,
): readonly ContentBlock[] {
  const existing = blocks[index];
  if (existing !== undefined && existing.type === type) {
    return setBlock(blocks, index, { type, text: existing.text + delta });
  }
  return setBlock(blocks, index, { type, text: delta });
}

/** One edit to the blocks of the message pi is streaming. */
export type BlockEdit = (blocks: readonly ContentBlock[]) => readonly ContentBlock[];

type AssistantUpdate = Extract<
  JsonAgentSessionEvent,
  { readonly type: "message_update" }
>["assistantMessageEvent"];

/**
 * The edit one pi update asks for, or `null` when it changes nothing the transcript shows: partial
 * tool-call arguments arrive as JSON that is not parseable yet, and the end event carries the parsed
 * call, so only the end is applied.
 */
export function blockEditOf(update: AssistantUpdate): BlockEdit | null {
  switch (update.type) {
    case "text_start":
      return (blocks) =>
        setBlock(blocks, update.contentIndex, { type: ContentBlockType.Text, text: "" });
    case "text_delta":
      return (blocks) =>
        appendBlock(blocks, update.contentIndex, ContentBlockType.Text, update.delta);
    case "text_end":
      return (blocks) =>
        setBlock(blocks, update.contentIndex, {
          type: ContentBlockType.Text,
          text: update.content,
        });
    case "thinking_start":
      return (blocks) =>
        setBlock(blocks, update.contentIndex, { type: ContentBlockType.Reasoning, text: "" });
    case "thinking_delta":
      return (blocks) =>
        appendBlock(blocks, update.contentIndex, ContentBlockType.Reasoning, update.delta);
    case "thinking_end":
      return (blocks) =>
        setBlock(blocks, update.contentIndex, {
          type: ContentBlockType.Reasoning,
          text: update.content,
        });
    case "toolcall_start":
      return (blocks) =>
        setBlock(blocks, update.contentIndex, {
          type: ContentBlockType.ToolCall,
          id: update.id,
          name: update.toolName,
          arguments: {},
          status: ToolCallStatus.Running,
        });
    case "toolcall_end":
      return (blocks) =>
        setBlock(blocks, update.contentIndex, {
          type: ContentBlockType.ToolCall,
          id: update.toolCall.id,
          name: update.toolCall.name,
          arguments: update.toolCall.arguments,
          status: ToolCallStatus.Running,
        });
    default:
      return null;
  }
}

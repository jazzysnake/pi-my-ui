/**
 * Block edits for a message that is still streaming: pi reports content by index, and a partial
 * update may name an index the assistant turn has not produced a block for yet. Those gaps are
 * filled with empty text so a later block's index addresses the right slot.
 */

import { ContentBlockType, type ContentBlock } from "@pi-my-ui/protocol";

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

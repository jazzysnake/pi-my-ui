/**
 * The message tree the `/tree` modal renders, and the one command that moves a Session's Leaf. Both
 * ends share the shape because the modal needs the branches off the active path, not only the path.
 */

import type { MessageRole } from "./constants.js";

export interface TreeEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly role: MessageRole | null;
  /** pi's entry type, so a row can say what a non-message entry is. */
  readonly entryType: string;
  /** One line, but exact for a user message: selecting one puts its text back in the composer. */
  readonly text: string;
  readonly label?: string;
}

export interface TreeNode {
  readonly entry: TreeEntry;
  readonly children: readonly TreeNode[];
}

export interface SessionTree {
  readonly roots: readonly TreeNode[];
  readonly leafId: string | null;
}

/** The command the bridge registers: pi offers no RPC command that moves the Leaf. */
export const LEAF_NAVIGATION_COMMAND = "pi-my-ui-tree";

/** The prompt that asks the bridge's command to move the Leaf to `entryId`. */
export function leafNavigationInvocation(entryId: string): string {
  return `/${LEAF_NAVIGATION_COMMAND} ${entryId}`;
}

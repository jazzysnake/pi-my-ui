/**
 * The message tree the `/tree` modal browses, narrowed from what pi answers.
 *
 * pi already owns the tree (`get_tree`), so the server narrows pi's answer into the protocol's shape
 * instead of rebuilding a tree from the transcript: a rebuilt one could disagree with the file the
 * Leaf move then names.
 *
 * Rows carry one line each. An assistant turn is truncated because browsing never needs a whole
 * reply; a user message keeps its exact text, because selecting it is how that text gets edited and
 * resubmitted.
 */

import { MessageRole, type SessionTree, type TreeEntry, type TreeNode } from "@pi-my-ui/protocol";
import type { SessionEntry, SessionTreeNode } from "@earendil-works/pi-coding-agent";

/** Longest text a row carries for an entry whose text the user cannot edit. */
export const MAX_TREE_ROW_TEXT_LENGTH = 120;

const ELLIPSIS = "\u2026";

function textBlocks(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null && "text" in block) {
      const text = (block as { readonly text?: unknown }).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

/** The transcript role of an entry, or `null` for an entry the transcript has no row for. */
function roleOf(entry: SessionEntry): MessageRole | null {
  if (entry.type !== "message") {
    return null;
  }
  switch (entry.message.role) {
    case "user":
      return MessageRole.User;
    case "assistant":
      return MessageRole.Assistant;
    case "toolResult":
      return MessageRole.ToolResult;
    case "bashExecution":
      return MessageRole.Bash;
    case "custom":
      return MessageRole.Notification;
    default:
      return null;
  }
}

type MessageEntry = Extract<SessionEntry, { readonly type: "message" }>["message"];

/** The text a message entry carries, by the role's own shape: only some roles have content blocks. */
function messageText(message: MessageEntry): string {
  switch (message.role) {
    case "bashExecution":
      return message.command;
    case "branchSummary":
    case "compactionSummary":
      return message.summary;
    default:
      return "content" in message ? textBlocks(message.content) : "";
  }
}

/** An entry's own text, before any row truncation. */
function entryText(entry: SessionEntry): string {
  switch (entry.type) {
    case "message":
      return messageText(entry.message);
    case "custom_message":
      return textBlocks(entry.content);
    case "compaction":
      return entry.summary;
    case "branch_summary":
      return entry.summary;
    case "label":
      return entry.label ?? "";
    case "session_info":
      return entry.name ?? "";
    case "model_change":
      return `${entry.provider}/${entry.modelId}`;
    case "thinking_level_change":
      return entry.thinkingLevel;
    case "custom":
      // An extension's own entry has no message text, so its type is what tells rows apart.
      return entry.customType;
    default:
      return "";
  }
}

/** One line, whitespace collapsed and cut to a row's worth. */
function rowLine(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  const characters = [...collapsed];
  if (characters.length <= MAX_TREE_ROW_TEXT_LENGTH) {
    return collapsed;
  }
  return `${characters.slice(0, MAX_TREE_ROW_TEXT_LENGTH - 1).join("")}${ELLIPSIS}`;
}

function toTreeEntry(entry: SessionEntry, label: string | undefined): TreeEntry {
  const role = roleOf(entry);
  const text = entryText(entry);
  return {
    id: entry.id,
    parentId: entry.parentId,
    role,
    entryType: entry.type,
    text: role === MessageRole.User ? text : rowLine(text),
    ...(label === undefined ? {} : { label }),
  };
}

function toTreeNode(node: SessionTreeNode): TreeNode {
  return {
    entry: toTreeEntry(node.entry, node.label),
    children: node.children.map(toTreeNode),
  };
}

/** Narrow pi's tree answer into the shape the modal renders. */
export function projectTree(tree: readonly SessionTreeNode[], leafId: string | null): SessionTree {
  return { roots: tree.map(toTreeNode), leafId };
}

function findNode(nodes: readonly SessionTreeNode[], entryId: string): SessionTreeNode | undefined {
  for (const node of nodes) {
    if (node.entry.id === entryId) {
      return node;
    }
    const found = findNode(node.children, entryId);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * The Leaf pi's `navigateTree(targetId)` leaves the Session on. pi moves a user message (or an
 * extension's custom message) to its **parent**, which is what makes the message editable and
 * resubmittable, and any other entry to **itself**. `undefined` means the id is not in this Session,
 * which pi refuses as `Entry … not found`; the caller reports that as a refusal, never a move.
 */
export function expectedLeafAfterNavigate(
  tree: readonly SessionTreeNode[],
  targetId: string,
): string | null | undefined {
  const node = findNode(tree, targetId);
  if (node === undefined) {
    return undefined;
  }
  const isUserEditable =
    (node.entry.type === "message" && node.entry.message.role === "user") ||
    node.entry.type === "custom_message";
  return isUserEditable ? node.entry.parentId : node.entry.id;
}

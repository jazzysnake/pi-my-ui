/**
 * The message tree's rows: which entries the modal shows, at what depth, and what a search matches.
 *
 * Pure and Svelte-free, so the modal owns only its view state (the expanded set, the query, the
 * highlighted row) and every decision about which rows that state yields lives here.
 *
 * A node is a **branch point** only when it has more than one child. A one-child node is a
 * continuation of its parent, not an alternative, so it adds no indent; the active path is descended
 * through it directly and a linear Session renders as a flat list.
 *
 * Off the active path a one-child node is something else: it is an alternative like any other, so its
 * child is hidden until the user opens it. Without a control on that row the rest of an abandoned
 * branch would be reachable only by searching for it, which is why `expandable` covers it.
 */

import { MessageRole, type SessionTree, type TreeNode } from "@pi-my-ui/protocol";

import { fuzzyScore } from "../commands/filter.js";
import type { IconName } from "../icons/index.js";

/** One rendered tree row: the node, its indent depth, and the state the row paints. */
export interface TreeRow {
  readonly node: TreeNode;
  /** Nesting depth from a root; the row indents by it, and it grows only past a branch point. */
  readonly depth: number;
  /** How many direct children the node has, which is what a collapsed row counts. */
  readonly childCount: number;
  /** Whether the node's children are shown. A node with no children is never expanded. */
  readonly expanded: boolean;
  /**
   * Whether the row carries an expand control. A branch point always does. An off-path one-child
   * node does too, because its child starts hidden and nothing else on the row would reveal it.
   */
  readonly expandable: boolean;
  /** Whether the node lies on the active branch (root → Leaf). */
  readonly onActivePath: boolean;
  /** Whether the node is the current Leaf. */
  readonly isLeaf: boolean;
}

/** One search result and the ancestors that must be expanded to reveal it. */
export interface TreeSearchMatch {
  readonly node: TreeNode;
  readonly ancestorIds: readonly string[];
  readonly score: number;
}

/** Indent added per nesting level past a branch point, in rem. Chosen, not measured. */
const ROW_INDENT_STEP_REM = 0.75;
/** Leading indent of every row, in rem. Chosen, not measured. */
const ROW_INDENT_BASE_REM = 0.25;
/**
 * Ceiling on a row's indent, in viewport-width percent. A deeply nested row would otherwise push its
 * own controls off a phone screen, which is the one thing the modal must never do.
 */
const ROW_INDENT_MAX_VW = 40;

/** The CSS `padding-left` for a row at `depth`, capped so a deep row stays tappable. */
export function rowIndent(depth: number): string {
  const rem = ROW_INDENT_BASE_REM + depth * ROW_INDENT_STEP_REM;
  return `min(${String(rem)}rem, ${String(ROW_INDENT_MAX_VW)}vw)`;
}

/** The ids on the path from a root to the Leaf, inclusive; empty when the Leaf is unknown. */
function activePathIds(tree: SessionTree): ReadonlySet<string> {
  const path: string[] = [];
  function find(nodes: readonly TreeNode[]): boolean {
    for (const node of nodes) {
      path.push(node.entry.id);
      if (node.entry.id === tree.leafId) {
        return true;
      }
      if (find(node.children)) {
        return true;
      }
      path.pop();
    }
    return false;
  }
  return tree.leafId !== null && find(tree.roots) ? new Set(path) : new Set();
}

/**
 * The ids that start expanded: the branch points on the active path, so the whole path to the Leaf
 * is visible and every alternative hangs off it collapsed.
 */
export function defaultExpandedIds(tree: SessionTree): ReadonlySet<string> {
  const onActivePath = activePathIds(tree);
  const expanded = new Set<string>();
  function visit(nodes: readonly TreeNode[]): void {
    for (const node of nodes) {
      if (node.children.length > 1 && onActivePath.has(node.entry.id)) {
        expanded.add(node.entry.id);
      }
      visit(node.children);
    }
  }
  visit(tree.roots);
  return expanded;
}

/**
 * Flatten the tree into rows, emitting a node's children only when its subtree is shown: it is an
 * expanded node, or a continuation on the active path. A collapsed row is still emitted with its
 * child count, so a branch is visible as a place to open rather than disappearing.
 */
export function flattenTree(tree: SessionTree, expanded: ReadonlySet<string>): readonly TreeRow[] {
  const onActivePath = activePathIds(tree);
  const rows: TreeRow[] = [];
  function visit(nodes: readonly TreeNode[], depth: number): void {
    for (const node of nodes) {
      const childCount = node.children.length;
      const onPath = onActivePath.has(node.entry.id);
      const showsChildren =
        childCount > 0 && (expanded.has(node.entry.id) || (childCount === 1 && onPath));
      rows.push({
        node,
        depth,
        childCount,
        expanded: showsChildren,
        expandable: childCount > 1 || (childCount === 1 && !onPath),
        onActivePath: onPath,
        isLeaf: tree.leafId !== null && node.entry.id === tree.leafId,
      });
      if (showsChildren) {
        visit(node.children, childCount > 1 ? depth + 1 : depth);
      }
    }
  }
  visit(tree.roots, 0);
  return rows;
}

/** A new set with one node's expansion toggled; the caller's set is never mutated. */
export function toggleExpanded(
  expanded: ReadonlySet<string>,
  entryId: string,
): ReadonlySet<string> {
  const next = new Set(expanded);
  if (!next.delete(entryId)) {
    next.add(entryId);
  }
  return next;
}

/** A new set with every ancestor of a picked result added, so a searched-for node is revealed. */
export function withAncestors(
  expanded: ReadonlySet<string>,
  ancestorIds: readonly string[],
): ReadonlySet<string> {
  const next = new Set(expanded);
  for (const id of ancestorIds) {
    next.add(id);
  }
  return next;
}

/** The text a query is matched against: the row's text, its label and its kind. */
function searchableText(node: TreeNode): string {
  const parts = [node.entry.text];
  if (node.entry.label !== undefined) {
    parts.push(node.entry.label);
  }
  parts.push(node.entry.role ?? node.entry.entryType);
  return parts.join(" ");
}

/**
 * Every node matching `query`, best score first and ties in tree order. A blank query matches
 * nothing: the modal shows the tree, not a flat list, until the user types.
 */
export function searchTree(tree: SessionTree, query: string): readonly TreeSearchMatch[] {
  if (query.trim() === "") {
    return [];
  }
  const scored: { match: TreeSearchMatch; position: number }[] = [];
  function visit(nodes: readonly TreeNode[], ancestors: readonly string[]): void {
    for (const node of nodes) {
      const score = fuzzyScore(query, searchableText(node));
      if (score !== null) {
        scored.push({
          match: { node, ancestorIds: ancestors, score },
          position: scored.length,
        });
      }
      visit(node.children, [...ancestors, node.entry.id]);
    }
  }
  visit(tree.roots, []);
  scored.sort(
    (left, right) => right.match.score - left.match.score || left.position - right.position,
  );
  return scored.map((entry) => entry.match);
}

/** Whether a row offers a fork: pi forks a Session from a user message, and from nothing else. */
export function isForkable(node: TreeNode): boolean {
  return node.entry.role === MessageRole.User;
}

/**
 * What a row is, as far as its presentation goes: one value that both its glyph and its label read,
 * so the two cannot drift apart when a kind is added.
 */
type RowKind =
  | "user"
  | "assistant"
  | "toolResult"
  | "bash"
  | "notification"
  | "compaction"
  | "branchSummary"
  | "other";

function rowKindOf(node: TreeNode): RowKind {
  switch (node.entry.role) {
    case MessageRole.User:
      return "user";
    case MessageRole.Assistant:
      return "assistant";
    case MessageRole.ToolResult:
      return "toolResult";
    case MessageRole.Bash:
      return "bash";
    case MessageRole.Notification:
      return "notification";
    case null:
      // A non-message entry carries no role, so pi's entry type is what tells its kind apart. A
      // compaction or branch-summary *message* also arrives role-less with entryType "message",
      // indistinguishable from any other unprojected role, so it draws as "other" until the wire
      // carries those roles.
      switch (node.entry.entryType) {
        case "compaction":
          return "compaction";
        case "branch_summary":
          return "branchSummary";
        default:
          return "other";
      }
    default:
      return "other";
  }
}

/** One row kind's glyph and label; `other` has no label of its own, so pi's entry type names it. */
interface RowPresentation {
  readonly glyph: IconName;
  readonly label?: string;
}

const ROW_PRESENTATION: Readonly<Record<RowKind, RowPresentation>> = {
  user: { glyph: "user", label: "you" },
  assistant: { glyph: "bot", label: "assistant" },
  toolResult: { glyph: "hammer", label: "tool result" },
  bash: { glyph: "terminal", label: "bash" },
  notification: { glyph: "pencil", label: "notification" },
  compaction: { glyph: "layers" },
  branchSummary: { glyph: "git-branch" },
  other: { glyph: "dot" },
};

/** The glyph that leads a row, from the client's one pack. */
export function entryGlyph(node: TreeNode): IconName {
  return ROW_PRESENTATION[rowKindOf(node)].glyph;
}

/** A short label for what a row is, falling back to pi's entry type when the kind has none. */
export function entryKindLabel(node: TreeNode): string {
  return ROW_PRESENTATION[rowKindOf(node)].label ?? node.entry.entryType;
}

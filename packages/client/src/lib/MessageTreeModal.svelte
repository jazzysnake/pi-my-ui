<script lang="ts">
  /**
   * The `/tree` modal: one dialog for the typed command and the composer's branch control.
   *
   * On open only the branch points on the active path are expanded, so every alternative hangs off
   * it collapsed and counted. A row is presentational: a selection is reported upward and the leaf
   * move is the server's to confirm, so the modal shows the refusal and stays open rather than
   * closing as if the switch had happened.
   */
  import { tick } from "svelte";

  import type { SessionTree, TreeNode } from "@pi-my-ui/protocol";

  import {
    defaultExpandedIds,
    entryKindLabel,
    flattenTree,
    rowIndent,
    searchTree,
    toggleExpanded,
    withAncestors,
  } from "./tree/rows.js";

  let {
    tree,
    loading,
    error,
    moveError,
    movingEntryId,
    onSelect,
    onClose,
  }: {
    /** The server's tree, or `null` while the request is in flight. */
    tree: SessionTree | null;
    loading: boolean;
    /** Why the tree could not be read, in the server's words. */
    error: string | null;
    /** Why the last selection's move was refused, in the server's words. */
    moveError: string | null;
    /** The entry whose move is in flight, so its row can say it is waiting. */
    movingEntryId: string | null;
    onSelect: (entry: TreeNode) => void;
    onClose: () => void;
  } = $props();

  let query = $state("");
  let expanded = $state<ReadonlySet<string>>(new Set());
  /** The row a search jump landed on, drawn highlighted until the next search. */
  let highlightedId = $state<string | null>(null);
  let body = $state<HTMLElement | null>(null);

  // A fresh tree resets the view to the collapsed-by-default expansion rather than keeping the set
  // from a previous Session's ids, none of which exist in this one.
  $effect(() => {
    if (tree !== null) {
      expanded = defaultExpandedIds(tree);
      highlightedId = null;
    }
  });

  const rows = $derived(tree === null ? [] : flattenTree(tree, expanded));
  const matches = $derived(tree === null ? [] : searchTree(tree, query));
  const searching = $derived(query.trim() !== "");

  function toggle(row: { readonly node: TreeNode }): void {
    expanded = toggleExpanded(expanded, row.node.entry.id);
  }

  /** Reveal a picked result: expand its ancestors, clear the query, then scroll it into view. */
  async function jumpTo(match: {
    readonly node: TreeNode;
    readonly ancestorIds: readonly string[];
  }) {
    expanded = withAncestors(expanded, match.ancestorIds);
    highlightedId = match.node.entry.id;
    query = "";
    await tick();
    // Matched by data attribute rather than by interpolating an id into a selector, which an id
    // containing a quote or bracket would break.
    const row = [...(body?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [])].find(
      (candidate) => candidate.dataset["entryId"] === match.node.entry.id,
    );
    row?.scrollIntoView?.({ block: "center" });
  }
</script>

<div
  class="absolute inset-0 z-40 flex flex-col bg-neutral-950"
  role="dialog"
  aria-modal="true"
  aria-label="Message tree"
  data-testid="message-tree-modal"
>
  <div class="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
    <span class="min-w-0 flex-1 text-sm font-semibold tracking-wide uppercase">Message tree</span>
    <button
      type="button"
      class="grid size-11 shrink-0 place-items-center rounded border border-neutral-700 text-neutral-300"
      aria-label="Close message tree"
      data-testid="message-tree-close"
      onclick={onClose}
    >
      ×
    </button>
  </div>

  <div class="border-b border-neutral-800 px-3 py-2">
    <input
      type="search"
      bind:value={query}
      aria-label="Search the message tree"
      placeholder="Search messages"
      class="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-2 text-sm"
      data-testid="message-tree-search"
    />
  </div>

  {#if moveError !== null}
    <p
      class="border-b border-neutral-800 px-3 py-2 text-xs text-red-400"
      role="alert"
      data-testid="message-tree-move-error"
    >
      {moveError}
    </p>
  {/if}

  <div bind:this={body} class="min-h-0 flex-1 overflow-y-auto" data-testid="message-tree-body">
    {#if error !== null}
      <p class="px-3 py-4 text-xs text-red-400" role="alert" data-testid="message-tree-error">
        {error}
      </p>
    {:else if tree === null}
      <p class="px-3 py-4 text-xs text-neutral-400" data-testid="message-tree-loading">
        {loading ? "Loading the message tree…" : "The message tree is not available."}
      </p>
    {:else if searching}
      {#if matches.length === 0}
        <p class="px-3 py-4 text-xs text-neutral-400" data-testid="message-tree-no-results">
          No matching entries
        </p>
      {:else}
        <ul aria-label="Search results">
          {#each matches as match (match.node.entry.id)}
            <li class="border-b border-neutral-800">
              <button
                type="button"
                class="flex min-h-11 w-full items-baseline gap-2 px-3 text-left"
                data-testid="message-tree-match"
                onclick={() => {
                  void jumpTo(match);
                }}
              >
                <span class="shrink-0 text-xs tracking-wider text-neutral-500 uppercase">
                  {entryKindLabel(match.node)}
                </span>
                <span class="min-w-0 truncate text-sm text-neutral-100">
                  {match.node.entry.text}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <ul aria-label="Message tree">
        {#each rows as row (row.node.entry.id)}
          <li
            class="flex items-stretch border-b border-neutral-800"
            class:bg-neutral-900={row.isLeaf || highlightedId === row.node.entry.id}
            data-testid="message-tree-row"
            data-entry-id={row.node.entry.id}
            data-active={row.onActivePath ? "true" : "false"}
            data-depth={String(row.depth)}
            data-leaf={row.isLeaf ? "true" : "false"}
            data-highlighted={highlightedId === row.node.entry.id ? "true" : "false"}
          >
            {#if row.childCount > 1}
              <button
                type="button"
                class="grid min-h-11 min-w-11 shrink-0 place-items-center text-xs text-neutral-400"
                style:padding-left={rowIndent(row.depth)}
                aria-expanded={row.expanded}
                aria-label={row.expanded
                  ? "Collapse branch"
                  : `Expand ${String(row.childCount)} replies`}
                data-testid="message-tree-toggle"
                onclick={() => {
                  toggle(row);
                }}
              >
                <span class="flex items-center gap-1">
                  <span aria-hidden="true">{row.expanded ? "▾" : "▸"}</span>
                  {#if !row.expanded}<span data-testid="message-tree-count"
                      >{String(row.childCount)}</span
                    >{/if}
                </span>
              </button>
            {:else}
              <span
                class="min-w-11 shrink-0"
                style:padding-left={rowIndent(row.depth)}
                aria-hidden="true"
              ></span>
            {/if}
            <button
              type="button"
              class="flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-3 text-left"
              data-testid="message-tree-select"
              onclick={() => {
                onSelect(row.node);
              }}
            >
              <span
                class="shrink-0 text-xs tracking-wider uppercase"
                class:text-neutral-100={row.onActivePath}
                class:text-neutral-500={!row.onActivePath}>{entryKindLabel(row.node)}</span
              >
              <span
                class="min-w-0 flex-1 truncate text-sm"
                class:text-neutral-100={row.onActivePath}
                class:text-neutral-400={!row.onActivePath}>{row.node.entry.text}</span
              >
              {#if row.isLeaf}
                <span class="shrink-0 text-xs text-neutral-300" data-testid="message-tree-current"
                  >leaf</span
                >
              {:else if movingEntryId === row.node.entry.id}
                <span class="shrink-0 text-xs text-neutral-400" data-testid="message-tree-moving"
                  >moving…</span
                >
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<script lang="ts">
  /**
   * The read-only file tree of the served working directory, opened from the shell's Files control.
   * It names the root it reflects (one server serves one working directory, so every Session shares
   * it) and is driven entirely by listings the store received, so a failed listing shows as a failure
   * rather than an empty directory.
   *
   * A directory's children are fetched the first time it is expanded and never before. A file row
   * downloads on tap; a text-like name also offers a preview.
   */
  import { FileEntryType, isPreviewableName } from "@pi-my-ui/protocol";

  import type { FilesSlice } from "../store/files.svelte.js";
  import FilePreview from "./FilePreview.svelte";
  import { ROOT_PATH, visibleRows } from "./rows.js";

  let {
    cwd,
    files,
    onClose,
    onListDirectory,
    onPreviewFile,
    onDownloadFile,
  }: {
    cwd: string;
    files: FilesSlice;
    onClose: () => void;
    onListDirectory: (path: string) => void;
    onPreviewFile: (path: string) => void;
    onDownloadFile: (path: string) => void;
  } = $props();

  let expanded = $state<Record<string, boolean>>({});
  let preview = $state<{ path: string; name: string } | null>(null);

  const rows = $derived(visibleRows(files, expanded));
  const rootListing = $derived(files.listingFor(ROOT_PATH));
  const rootFailure = $derived(files.failureFor(ROOT_PATH));

  function toggle(path: string): void {
    // A node whose listing failed retries on tap; a successful listing clears the failure.
    if (files.failureFor(path) !== undefined) {
      onListDirectory(path);
      return;
    }
    const next = expanded[path] !== true;
    expanded = { ...expanded, [path]: next };
    if (next && files.listingFor(path) === undefined) {
      onListDirectory(path);
    }
  }

  function openPreview(path: string, name: string): void {
    preview = { path, name };
    onPreviewFile(path);
  }
</script>

<div class="absolute inset-0 z-30 flex">
  <button type="button" class="flex-1 bg-scrim" aria-label="Close files" onclick={onClose}></button>

  <aside
    class="flex w-[88%] max-w-md flex-col border-l border-hairline-strong bg-panel"
    aria-label="Files"
    data-testid="file-tree"
  >
    <div class="flex items-center gap-2 border-b border-hairline px-3 py-2">
      <span class="min-w-0 flex-1">
        <span class="block text-meta tracking-wider text-dim uppercase">Files</span>
        <span class="block truncate text-meta text-dim" data-testid="file-tree-cwd">{cwd}</span>
      </span>
      <button
        type="button"
        class="grid min-h-11 min-w-11 place-items-center rounded border border-hairline-strong text-dim"
        aria-label="Close files"
        data-testid="file-tree-close"
        onclick={onClose}
      >
        ✕
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if rootFailure !== undefined}
        <p class="px-3 py-4 text-danger" data-testid="file-tree-error">{rootFailure}</p>
      {:else if rootListing === undefined}
        <p class="px-3 py-4 text-dim" data-testid="file-tree-loading">Loading…</p>
      {:else if rows.length === 0}
        <p class="px-3 py-4 text-dim" data-testid="file-tree-empty">This directory is empty.</p>
      {:else}
        <ul data-testid="file-tree-list">
          {#each rows as row (row.path)}
            <li class="border-b border-hairline">
              {#if row.entry.type === FileEntryType.Directory}
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center gap-2 px-3 text-left"
                  style:padding-left={`${0.75 + row.depth * 0.9}rem`}
                  aria-expanded={row.expanded}
                  data-testid="file-tree-directory"
                  data-path={row.path}
                  onclick={() => toggle(row.path)}
                >
                  <span class="w-3 shrink-0 text-dim">{row.expanded ? "▾" : "▸"}</span>
                  <span class="truncate text-body text-ink" data-testid="file-tree-name"
                    >{row.name}/</span
                  >
                  {#if row.loading}
                    <span class="ml-auto text-meta text-faint">…</span>
                  {:else if row.failure !== null}
                    <span class="ml-auto text-meta text-danger" data-testid="file-tree-node-error"
                      >{row.failure}</span
                    >
                  {/if}
                </button>
              {:else}
                <div
                  class="flex w-full items-center gap-2 px-3"
                  style:padding-left={`${0.75 + row.depth * 0.9}rem`}
                >
                  <button
                    type="button"
                    class="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                    data-testid="file-tree-file"
                    data-path={row.path}
                    onclick={() => onDownloadFile(row.path)}
                  >
                    <span class="truncate text-body text-ink" data-testid="file-tree-name"
                      >{row.name}</span
                    >
                    {#if row.entry.size !== null}
                      <span class="ml-auto text-meta text-faint" data-testid="file-tree-size"
                        >{row.entry.size} B</span
                      >
                    {/if}
                  </button>
                  {#if isPreviewableName(row.name)}
                    <button
                      type="button"
                      class="min-h-11 shrink-0 rounded border border-hairline-strong px-2 text-meta text-success"
                      data-testid="file-tree-preview"
                      data-path={row.path}
                      aria-label={`Preview ${row.name}`}
                      onclick={() => openPreview(row.path, row.name)}
                    >
                      Preview
                    </button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </aside>

  {#if preview !== null}
    <FilePreview
      path={preview.path}
      name={preview.name}
      {files}
      onClose={() => {
        preview = null;
      }}
      onDownload={() => {
        if (preview !== null) {
          onDownloadFile(preview.path);
        }
      }}
    />
  {/if}
</div>

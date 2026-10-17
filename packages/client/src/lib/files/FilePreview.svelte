<script lang="ts">
  /**
   * The read-only text preview: a bounded, inline look at a text-like file, with the full download
   * one tap away. The truncation is stated rather than implied, so a reader never mistakes a prefix
   * for the whole file. The body arrives as a `filePreview` message and is always text, so an HTML
   * file is shown as source, never rendered.
   */
  import { PREVIEW_MAX_BYTES } from "@pi-my-ui/protocol";

  import type { FilesSlice } from "../store/files.svelte.js";

  let {
    path,
    name,
    files,
    onClose,
    onDownload,
  }: {
    path: string;
    name: string;
    files: FilesSlice;
    onClose: () => void;
    onDownload: () => void;
  } = $props();

  const preview = $derived(files.previewFor(path));
  const previewKilobytes = Math.round(PREVIEW_MAX_BYTES / 1024);
</script>

<div class="absolute inset-0 z-40 flex">
  <button type="button" class="flex-1 bg-scrim" aria-label="Close preview" onclick={onClose}
  ></button>

  <aside
    class="flex w-[92%] max-w-md flex-col border-l border-hairline-strong bg-panel"
    aria-label="File preview"
    data-testid="file-preview"
  >
    <div class="flex items-center gap-2 border-b border-hairline px-3 py-2">
      <span class="min-w-0 flex-1 truncate text-meta text-ink">{name}</span>
      <button
        type="button"
        class="min-h-11 rounded border border-hairline-strong px-3 text-meta text-success"
        data-testid="file-preview-download"
        onclick={onDownload}
      >
        Download
      </button>
      <button
        type="button"
        class="grid min-h-11 min-w-11 place-items-center rounded border border-hairline-strong text-dim"
        aria-label="Close preview"
        data-testid="file-preview-close"
        onclick={onClose}
      >
        ✕
      </button>
    </div>

    {#if preview?.truncated === true}
      <p
        class="border-b border-hairline px-3 py-2 text-meta text-warning"
        data-testid="file-preview-truncated"
      >
        Preview truncated — showing the first {previewKilobytes} KB of {preview.size} B. Download for
        the whole file.
      </p>
    {/if}

    <div class="min-h-0 flex-1 overflow-auto p-3">
      {#if preview === undefined}
        <p class="text-dim" data-testid="file-preview-loading">Loading…</p>
      {:else}
        <pre
          class="text-meta break-words whitespace-pre-wrap text-ink"
          data-testid="file-preview-text">{preview.text}</pre>
      {/if}
    </div>
  </aside>
</div>

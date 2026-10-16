<script lang="ts">
  import { ContentBlockType, type ProjectedEntry } from "@pi-my-ui/protocol";

  let { entries }: { entries: readonly ProjectedEntry[] } = $props();

  let container = $state<HTMLElement | null>(null);
  let pinned = $state(true);

  const NEAR_BOTTOM_PX = 48;

  function handleScroll(): void {
    if (container === null) {
      return;
    }
    pinned =
      container.scrollHeight - container.scrollTop - container.clientHeight <= NEAR_BOTTOM_PX;
  }

  // Auto-scroll follows the stream only while the reader is already at the bottom; a reader who
  // scrolled up is never yanked back to the newest output.
  $effect(() => {
    const current = entries;
    if (pinned && container !== null) {
      container.scrollTop = current.length > 0 ? container.scrollHeight : 0;
    }
  });
</script>

<main
  bind:this={container}
  class="min-h-0 flex-1 overflow-y-auto px-3 py-2"
  data-testid="transcript"
  onscroll={handleScroll}
>
  {#each entries as entry (entry.id)}
    <article
      class="mb-3 last:mb-0"
      data-testid="transcript-entry"
      data-entry-id={entry.id}
      data-role={entry.role}
    >
      {#each entry.blocks as block, index (index)}
        {#if block.type === ContentBlockType.Text}
          <p class="text-sm break-words whitespace-pre-wrap">{block.text}</p>
        {:else if block.type === ContentBlockType.Reasoning}
          <details class="mb-1 rounded border border-neutral-800" data-testid="reasoning-block">
            <summary class="cursor-pointer px-2 py-1 text-xs text-neutral-400">Thinking</summary>
            <p class="px-2 pb-2 text-xs break-words whitespace-pre-wrap text-neutral-400">
              {block.text}
            </p>
          </details>
        {:else if block.type === ContentBlockType.ToolCall}
          <div
            class="mb-1 rounded border border-neutral-800 px-2 py-1 text-xs"
            data-testid="tool-call"
          >
            <span class="text-neutral-400">{block.name}</span>
          </div>
        {/if}
      {/each}
    </article>
  {/each}
</main>

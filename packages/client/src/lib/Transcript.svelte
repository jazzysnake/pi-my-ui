<script lang="ts">
  import { ContentBlockType, type ProjectedEntry } from "@pi-my-ui/protocol";

  let { entries }: { entries: readonly ProjectedEntry[] } = $props();
</script>

<main class="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="transcript">
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
        {/if}
      {/each}
    </article>
  {/each}
</main>

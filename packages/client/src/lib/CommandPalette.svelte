<script lang="ts">
  import { slashName } from "./commands/builtins.js";
  import type { PaletteEntry } from "./commands/palette.js";

  let {
    entries,
    highlighted,
    onChoose,
  }: {
    entries: readonly PaletteEntry[];
    highlighted: number;
    onChoose: (entry: PaletteEntry) => void;
  } = $props();
</script>

{#if entries.length > 0}
  <ul
    class="max-h-52 overflow-y-auto rounded border border-hairline-strong bg-panel py-1"
    role="listbox"
    aria-label="Commands"
    data-testid="command-palette"
  >
    {#each entries as entry, index (entry.key)}
      <li>
        <button
          type="button"
          class="flex min-h-11 w-full items-baseline gap-2 px-3 text-left text-body"
          role="option"
          aria-selected={index === highlighted}
          data-testid="command-palette-row"
          data-entry-key={entry.key}
          onclick={() => {
            onChoose(entry);
          }}
        >
          <span class="shrink-0 font-medium text-ink">{slashName(entry.name)}</span>
          <span class="min-w-0 flex-1 truncate text-meta text-dim">{entry.description}</span>
          <span
            class="shrink-0 rounded border border-hairline-strong px-1 text-meta text-dim"
            data-testid="command-badge">{entry.badge}</span
          >
        </button>
      </li>
    {/each}
  </ul>
{/if}

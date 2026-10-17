<script lang="ts">
  /** PROTOTYPE — the table an assistant message renders, styled as the shipped markdown table is. */
  let { rows }: { rows: readonly (readonly [string, string])[] } = $props();
</script>

<div class="mt-2 overflow-x-auto">
  <table class="w-full border-collapse text-meta">
    {#each rows as row, index (index)}
      {#if index === 0}
        <thead>
          <tr>
            {#each row as cell (cell)}
              <th class="border border-hairline-strong px-1.5 py-1 text-left font-medium text-dim">
                {cell}
              </th>
            {/each}
          </tr>
        </thead>
      {:else}
        <tbody>
          <tr>
            {#each row as cell (cell)}
              <td class="border border-hairline-strong px-1.5 py-1 text-left">{cell}</td>
            {/each}
          </tr>
        </tbody>
      {/if}
    {/each}
  </table>
</div>

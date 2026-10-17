<script lang="ts">
  import { BASH_MODE_PRESENTATION, parseBashPrefix } from "./mode.js";

  let { text }: { text: string } = $props();

  const prefix = $derived(parseBashPrefix(text));
  const presentation = $derived(prefix === null ? null : BASH_MODE_PRESENTATION[prefix.mode]);
</script>

{#if prefix !== null && presentation !== null}
  <p
    class="flex items-center gap-2 text-xs"
    data-testid="bash-mode-indicator"
    data-bash-mode={prefix.mode}
  >
    <span class="shrink-0 font-bold text-emerald-400" aria-hidden="true">{presentation.glyph}</span>
    <span class="shrink-0 text-neutral-200">{presentation.label}</span>
    <span class="min-w-0 text-neutral-500">{presentation.description}</span>
  </p>
{/if}

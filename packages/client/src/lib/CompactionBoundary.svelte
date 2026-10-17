<script lang="ts">
  import type { CompactionBoundaryEntry } from "@pi-my-ui/protocol";

  let { entry }: { entry: CompactionBoundaryEntry } = $props();
</script>

<!--
  The summary is plain text and never markdown: it is the model's account of arbitrary conversation,
  so parsing it as markup would let the conversation decide how the app renders.
-->
<div
  class="border-y border-neutral-700 bg-neutral-900 px-3 py-2"
  data-testid="compaction-boundary"
  data-tokens-before={entry.tokensBefore}
>
  <div class="flex items-center gap-2">
    <span class="tracking-wider text-amber-400 uppercase" data-testid="compaction-boundary-label">
      Context compacted here
    </span>
    <span class="ml-auto shrink-0 text-xs text-neutral-500"
      >{entry.tokensBefore.toLocaleString()} tokens before</span
    >
  </div>
  <details class="mt-1">
    <summary class="cursor-pointer text-xs text-neutral-400">Summary</summary>
    <p class="mt-1 text-xs break-words whitespace-pre-wrap text-neutral-400">{entry.summary}</p>
  </details>
</div>

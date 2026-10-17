<script lang="ts">
  import type { CompactionBoundaryEntry } from "@pi-my-ui/protocol";

  import Icon from "./Icon.svelte";

  let { entry }: { entry: CompactionBoundaryEntry } = $props();
</script>

<!--
  The summary is plain text and never markdown: it is the model's account of arbitrary conversation,
  so parsing it as markup would let the conversation decide how the app renders.
-->
<div
  class="border-y border-hairline-strong bg-panel px-3 py-2"
  data-testid="compaction-boundary"
  data-tokens-before={entry.tokensBefore}
>
  <div class="flex items-center gap-2">
    <Icon name="arrow-down-to-line" class="size-4 shrink-0 text-dim" />
    <span class="tracking-wider text-warning uppercase" data-testid="compaction-boundary-label">
      Context compacted here
    </span>
    <span class="ml-auto shrink-0 text-meta text-faint"
      >{entry.tokensBefore.toLocaleString()} tokens before</span
    >
  </div>
  <details class="mt-1">
    <summary class="flex min-h-11 cursor-pointer items-center text-meta text-dim">Summary</summary>
    <p class="mt-1 text-meta break-words whitespace-pre-wrap text-dim">{entry.summary}</p>
  </details>
</div>

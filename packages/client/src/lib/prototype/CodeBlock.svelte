<script lang="ts">
  /**
   * PROTOTYPE — code copy lives in a short header strip: the code scrolls sideways, so a control
   * pinned over the corner sits on code. The tap box is taller than the strip so the target stays
   * 44 px; the overflow lands on the block's own padding, not on another control.
   */
  import CopyButton from "./CopyButton.svelte";

  let { code }: { code: string } = $props();
</script>

<div class="mt-2 rounded border border-hairline bg-panel-raised">
  <div class="flex h-7 items-center justify-end pr-0.5">
    <CopyButton text={code} label="Copy code" class="size-11" />
  </div>
  <pre class="overflow-x-auto px-2 pb-1.5 text-meta text-dim"><code>{code}</code></pre>
</div>

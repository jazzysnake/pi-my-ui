<script lang="ts">
  /**
   * PROTOTYPE — the thinking row as an explicit disclosure.
   *
   * A `<details>` cannot host anything but its summary in the header, so the header is a button with
   * `aria-expanded`. The row carries no copy control: the message card's corner owns that, and a
   * second control here is what made a card's copy look like the thinking block's.
   */
  import { untrack } from "svelte";

  let {
    text,
    open = false,
    ruleClass = "",
  }: { text: string; open?: boolean; ruleClass?: string } = $props();

  let expanded = $state(untrack(() => open));
</script>

<div class="flex items-center gap-2">
  <button
    type="button"
    class="flex min-h-8 flex-1 items-center gap-1.5 text-left text-meta text-dim"
    aria-expanded={expanded}
    onclick={() => {
      expanded = !expanded;
    }}
  >
    <span class="text-[10px] text-faint">{expanded ? "▾" : "▸"}</span>
    <span>Thinking</span>
  </button>
  <span class={`h-px flex-1 ${ruleClass}`}></span>
</div>
{#if expanded}
  <p class="pb-1 text-meta break-words whitespace-pre-wrap text-dim">{text}</p>
{/if}

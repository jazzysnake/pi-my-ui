<script lang="ts">
  import Icon from "./Icon.svelte";

  let { text }: { text: string } = $props();
</script>

<details class="group mb-2 rounded border border-hairline bg-canvas" data-testid="reasoning-block">
  <summary
    class="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-2 text-meta text-dim [&::-webkit-details-marker]:hidden"
  >
    <Icon name="chevron-right" class="size-3 shrink-0 group-open:rotate-90" />
    <span>Thinking</span>
  </summary>
  <p class="px-2 pb-2 text-meta break-words whitespace-pre-wrap text-dim">{text}</p>
</details>

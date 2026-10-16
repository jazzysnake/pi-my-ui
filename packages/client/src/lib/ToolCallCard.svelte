<script lang="ts">
  import { ToolCallStatus, type ToolCallBlock } from "@pi-my-ui/protocol";

  let { block }: { block: ToolCallBlock } = $props();

  const LABELS: Readonly<Record<string, string>> = {
    [ToolCallStatus.Running]: "Running",
    [ToolCallStatus.Success]: "Done",
    [ToolCallStatus.Error]: "Failed",
  };

  const TONES: Readonly<Record<string, string>> = {
    [ToolCallStatus.Running]: "text-neutral-400",
    [ToolCallStatus.Success]: "text-emerald-400",
    [ToolCallStatus.Error]: "text-red-400",
  };

  const label = $derived(LABELS[block.status] ?? block.status);
  const tone = $derived(TONES[block.status] ?? "text-neutral-400");
</script>

<div
  class="mb-1 rounded border border-neutral-800 px-2 py-1 text-xs"
  data-testid="tool-card"
  data-tool-status={block.status}
>
  <div class="flex items-center gap-2">
    <span class="min-w-0 flex-1 truncate font-medium text-neutral-200" data-testid="tool-card-name"
      >{block.name}</span
    >
    <span class={`shrink-0 ${tone}`} data-testid="tool-card-status">{label}</span>
  </div>
  {#if block.output !== undefined && block.output !== ""}
    <pre
      class="mt-1 max-w-full overflow-x-auto border-t border-neutral-800 pt-1 text-neutral-400 break-words whitespace-pre-wrap"
      data-testid="tool-card-output">{block.output}</pre>
  {/if}
</div>

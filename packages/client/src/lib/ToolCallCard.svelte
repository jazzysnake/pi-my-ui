<script lang="ts">
  import { ToolCallStatus, type ToolCallBlock } from "@pi-my-ui/protocol";

  let { block }: { block: ToolCallBlock } = $props();

  const LABELS: Readonly<Record<string, string>> = {
    [ToolCallStatus.Running]: "Running",
    [ToolCallStatus.Success]: "Done",
    [ToolCallStatus.Error]: "Failed",
  };

  const TONES: Readonly<Record<string, string>> = {
    [ToolCallStatus.Running]: "text-dim",
    [ToolCallStatus.Success]: "text-success",
    [ToolCallStatus.Error]: "text-danger",
  };

  const label = $derived(LABELS[block.status] ?? block.status);
  const tone = $derived(TONES[block.status] ?? "text-dim");
</script>

<div
  class="mb-1 rounded border border-hairline px-2 py-1 text-meta"
  data-testid="tool-card"
  data-tool-status={block.status}
>
  <div class="flex items-center gap-2">
    <span class="min-w-0 flex-1 truncate font-medium text-ink" data-testid="tool-card-name"
      >{block.name}</span
    >
    <!--
      The pulse marks a call that is still in flight. It is decoration: the same element says
      "Running" in text, so dropping the animation under reduced motion loses nothing.
    -->
    <span
      class={`shrink-0 ${tone}`}
      class:animate-pulse={block.status === ToolCallStatus.Running}
      data-testid="tool-card-status">{label}</span
    >
  </div>
  {#if block.output !== undefined && block.output !== ""}
    <pre
      class="mt-1 max-w-full overflow-x-auto border-t border-hairline pt-1 text-dim break-words whitespace-pre-wrap"
      data-testid="tool-card-output">{block.output}</pre>
  {/if}
</div>

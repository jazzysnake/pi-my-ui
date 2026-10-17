<script lang="ts">
  import type { BashExecutionBlock } from "@pi-my-ui/protocol";

  import { BASH_MODE_PRESENTATION, BashStatus, bashStatus, modeForExecution } from "./bash/mode.js";

  let { block }: { block: BashExecutionBlock } = $props();

  const STATUS_LABELS: Readonly<Record<BashStatus, string>> = {
    [BashStatus.Running]: "running",
    [BashStatus.Ok]: "ok",
    [BashStatus.Error]: "error",
    [BashStatus.Aborted]: "aborted",
  };

  const STATUS_TONES: Readonly<Record<BashStatus, string>> = {
    [BashStatus.Running]: "text-neutral-400",
    [BashStatus.Ok]: "text-emerald-400",
    [BashStatus.Error]: "text-red-400",
    [BashStatus.Aborted]: "text-amber-400",
  };

  const mode = $derived(modeForExecution(block.excludeFromContext));
  const presentation = $derived(BASH_MODE_PRESENTATION[mode]);
  const status = $derived(bashStatus(block));
  const result = $derived(block.result);

  // A cancelled command has no meaningful code, and a signal-killed one has none at all; both are
  // stated rather than printed as a misleading `exit 0`.
  const exitText = $derived.by((): string | null => {
    const finished = result;
    if (finished === undefined) {
      return null;
    }
    if (finished.cancelled) {
      return "Aborted";
    }
    return finished.exitCode === null ? "No exit code" : `Exit code ${String(finished.exitCode)}`;
  });
</script>

<div
  class="mb-1 rounded border border-neutral-800 border-l-2 border-l-emerald-500 px-2 py-1 text-xs"
  data-testid="bash-card"
  data-bash-command-id={block.commandId}
  data-bash-mode={mode}
  data-bash-status={status}
>
  <div class="flex items-center gap-2">
    <span class="shrink-0 text-neutral-500" aria-hidden="true">$</span>
    <span
      class="min-w-0 flex-1 font-medium break-words whitespace-pre-wrap text-neutral-200"
      data-testid="bash-command">{block.command}</span
    >
    <span class={`shrink-0 ${STATUS_TONES[status]}`} data-testid="bash-status"
      >{STATUS_LABELS[status]}</span
    >
  </div>
  {#if block.output !== ""}
    <pre
      class="mt-1 max-h-60 max-w-full overflow-x-auto overflow-y-auto border-t border-neutral-800 pt-1 text-neutral-400 break-words whitespace-pre-wrap"
      data-testid="bash-output">{block.output}</pre>
  {/if}
  <div class="mt-1 flex flex-wrap items-center gap-2">
    <span
      class="rounded border border-neutral-700 px-1 tracking-wider text-neutral-400 uppercase"
      data-testid="bash-mode-label">{`${presentation.glyph} ${presentation.label}`}</span
    >
    <span class="min-w-0 flex-1 text-neutral-500" data-testid="bash-context"
      >{presentation.description}</span
    >
    {#if exitText !== null}
      <span class="shrink-0 text-neutral-400" data-testid="bash-exit">{exitText}</span>
    {/if}
  </div>
  {#if result?.truncated === true}
    <p class="mt-1 border-t border-neutral-800 pt-1 text-amber-400" data-testid="bash-truncation">
      Output truncated by pi.{#if result.fullOutputPath !== undefined}
        Full output on the server at <code class="break-all">{result.fullOutputPath}</code>.{/if}
    </p>
  {/if}
</div>

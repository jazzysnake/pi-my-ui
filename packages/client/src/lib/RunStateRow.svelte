<script lang="ts">
  import type { RunState } from "@pi-my-ui/protocol";

  import { runStateDisplay } from "./run-state.js";

  let { runState }: { runState: RunState } = $props();

  const display = $derived(runStateDisplay(runState));

  const TONES: Readonly<Record<string, string>> = {
    retrying: "text-amber-400",
    aborted: "text-amber-400",
    errored: "text-red-400",
  };
</script>

{#if display !== null}
  <!--
    A polite live region: a reader who cannot see the streaming output still learns what the run is
    doing. The row is removed for idle, so a recovered run leaves no stale error styling.
  -->
  <div
    class="flex min-h-11 items-center gap-2 border-t border-neutral-800 px-3 py-1 text-xs"
    role="status"
    aria-live="polite"
    data-testid="run-state"
    data-run-state={display.kind}
  >
    <span
      class={`shrink-0 tracking-wider uppercase ${TONES[display.kind] ?? "text-neutral-400"}`}
      data-testid="run-state-label">{display.label}</span
    >
    {#if display.detail !== null}
      <span class="min-w-0 flex-1 truncate text-neutral-400" data-testid="run-state-detail"
        >{display.detail}</span
      >
    {/if}
  </div>
{/if}

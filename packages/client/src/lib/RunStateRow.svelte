<script lang="ts">
  import type { RunState } from "@pi-my-ui/protocol";

  import { STARTING_DISPLAY, runStateDisplay } from "./run-state.js";

  let {
    runState,
    starting = false,
    onReconnect = () => undefined,
    onResume = onReconnect,
  }: {
    runState: RunState;
    starting?: boolean;
    onReconnect?: () => void;
    onResume?: () => void;
  } = $props();

  const display = $derived(starting ? STARTING_DISPLAY : runStateDisplay(runState));

  const TONES: Readonly<Record<string, string>> = {
    retrying: "text-warning",
    aborted: "text-warning",
    errored: "text-danger",
    crashed: "text-danger",
  };
</script>

{#if display !== null}
  <!--
    A polite live region: a reader who cannot see the streaming output still learns what the run is
    doing. The row is removed for idle, so a recovered run leaves no stale error styling.
  -->
  <div
    class="flex min-h-11 items-center gap-2 border-t border-hairline px-3 py-1 text-meta"
    role="status"
    aria-live="polite"
    data-testid="run-state"
    data-run-state={display.kind}
  >
    <span
      class={`shrink-0 tracking-wider uppercase ${TONES[display.kind] ?? "text-dim"}`}
      data-testid="run-state-label">{display.label}</span
    >
    {#if display.detail !== null}
      <span class="min-w-0 flex-1 truncate text-dim" data-testid="run-state-detail"
        >{display.detail}</span
      >
    {/if}
    {#if display.reconnect}
      <button
        type="button"
        class="min-h-11 shrink-0 rounded border border-hairline-strong px-3 text-ink"
        data-testid="session-reconnect"
        onclick={onReconnect}>Reconnect</button
      >
    {/if}
    {#if display.resume}
      <button
        type="button"
        class="min-h-11 shrink-0 rounded border border-hairline-strong px-3 text-ink"
        data-testid="session-resume"
        onclick={onResume}>Resume</button
      >
    {/if}
  </div>
{/if}

<script lang="ts">
  import { ConnectionStatus } from "./transport.js";

  let { status }: { status: ConnectionStatus } = $props();

  const LABELS: Record<ConnectionStatus, string> = {
    [ConnectionStatus.Connecting]: "Connecting",
    [ConnectionStatus.Connected]: "Connected",
    [ConnectionStatus.Reconnecting]: "Reconnecting",
  };

  const TONES: Record<ConnectionStatus, string> = {
    [ConnectionStatus.Connecting]: "text-amber-400",
    [ConnectionStatus.Connected]: "text-emerald-400",
    [ConnectionStatus.Reconnecting]: "text-amber-400",
  };

  const label = $derived(LABELS[status]);
  const tone = $derived(TONES[status]);
</script>

<!--
  A phone has no hover, so a tap focuses the wrapper and reveals the label. The wrapper stays in the
  flow and the label is absolutely positioned, so revealing it cannot move a control beside it.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<span
  class={`group relative inline-grid size-11 place-items-center rounded ${tone}`}
  role="status"
  aria-live="polite"
  tabindex="0"
  data-testid="connection-status"
  data-status={status}
>
  <span
    class="size-2 rounded-full bg-current"
    aria-hidden="true"
    data-testid="connection-status-dot"
  ></span>
  <span
    class="pointer-events-none absolute right-full mr-2 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs whitespace-nowrap opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
    data-testid="connection-status-label">{label}</span
  >
</span>

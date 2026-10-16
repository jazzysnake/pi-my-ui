<script lang="ts">
  import ConnectionStatusIndicator from "./ConnectionStatusIndicator.svelte";
  import Transcript from "./Transcript.svelte";
  import type { ClientStore } from "./store/client-store.svelte.js";
  import type { ConnectionStatus } from "./transport.js";

  let { store, status }: { store: ClientStore; status: ConnectionStatus } = $props();
</script>

<div
  class="flex h-dvh flex-col overflow-hidden bg-neutral-950 text-neutral-100"
  data-testid="app-shell"
>
  <header class="flex items-center gap-2 border-b border-neutral-800 px-3 py-1">
    <span class="text-sm font-semibold tracking-wide uppercase">pi-my-ui</span>
    <div class="ml-auto">
      <ConnectionStatusIndicator {status} />
    </div>
  </header>
  <Transcript entries={store.transcript.entries} />
</div>

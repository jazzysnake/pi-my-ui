<script lang="ts">
  /**
   * The two rows above the transcript: the navigation bar and the session bar.
   *
   * They are separate rows because they compete for different things. One row could not hold the
   * toggles, the agent pill, the connection dot and a context figure on a 320px screen without
   * pushing a control off the edge, so the navigation bar keeps the controls a thumb reaches for and
   * the wordmark truncates to make room, while the session bar carries the run's own state and the
   * context readout, right-aligned and apart from the composer's choosers.
   */
  import type { ClientStore } from "./store/client-store.svelte.js";
  import type { ConnectionStatus } from "./transport.js";

  import AgentPill from "./AgentPill.svelte";
  import ConnectionStatusIndicator from "./ConnectionStatusIndicator.svelte";
  import ContextUsageMeter from "./ContextUsageMeter.svelte";
  import Icon from "./Icon.svelte";
  import { isOutputInFlight } from "./run-state.js";

  let {
    store,
    status,
    onToggleSessions,
    onToggleFiles,
    onOpenAgents,
  }: {
    store: ClientStore;
    status: ConnectionStatus;
    onToggleSessions: () => void;
    onToggleFiles: () => void;
    onOpenAgents: () => void;
  } = $props();

  const outputInFlight = $derived(isOutputInFlight(store.transcript.runState));
</script>

<header
  class="flex min-h-11 items-center gap-1 border-b border-hairline px-2"
  data-testid="top-bar"
>
  <button
    type="button"
    class="grid size-11 shrink-0 place-items-center rounded border border-hairline-strong text-dim"
    aria-label="Toggle sessions sidebar"
    data-testid="sessions-toggle"
    onclick={onToggleSessions}
  >
    <Icon name="menu" />
  </button>
  <span class="min-w-0 truncate text-body font-semibold tracking-wide uppercase">pi-my-ui</span>
  <div class="ml-auto flex min-w-0 shrink-0 items-center gap-1">
    <AgentPill {store} onOpen={onOpenAgents} />
    <button
      type="button"
      class="grid size-11 shrink-0 place-items-center rounded border border-hairline-strong text-dim"
      aria-label="Files"
      data-testid="files-toggle"
      onclick={onToggleFiles}
    >
      <Icon name="folder" />
    </button>
    <ConnectionStatusIndicator {status} />
  </div>
</header>

<div
  class="flex min-h-11 items-center gap-2 border-b border-hairline px-3 text-meta"
  data-testid="session-bar"
>
  {#if outputInFlight}
    <span
      class="flex min-w-0 items-center gap-2 text-success"
      role="status"
      aria-live="polite"
      data-testid="run-activity"
    >
      <span class="size-2 shrink-0 animate-pulse rounded-full bg-current" aria-hidden="true"></span>
      <span class="truncate tracking-wider uppercase" data-testid="run-activity-label"
        >Streaming</span
      >
    </span>
  {/if}
  <div class="ml-auto flex min-w-0 shrink-0 items-center">
    {#if store.context.usage !== undefined}
      <ContextUsageMeter usage={store.context.usage} />
    {/if}
  </div>
</div>

<script lang="ts">
  /**
   * The two rows above the transcript: the navigation bar and the session bar.
   *
   * They are separate rows because they hold different things. The navigation bar keeps the controls
   * a thumb reaches for and lets the wordmark truncate to make room; the session bar carries the
   * run's own state — the agent pill at its leading edge, then the context readout on its trailing
   * edge, apart from the composer's choosers.
   */
  import type { ClientStore } from "./store/client-store.svelte.js";
  import type { ConnectionStatus } from "./transport.js";

  import AgentPill from "./AgentPill.svelte";
  import ConnectionStatusIndicator from "./ConnectionStatusIndicator.svelte";
  import ContextUsageMeter from "./ContextUsageMeter.svelte";
  import Icon from "./Icon.svelte";

  let {
    store,
    status,
    onToggleSessions,
    onToggleFiles,
    onOpenAgents,
    filesEnabled = true,
  }: {
    store: ClientStore;
    status: ConnectionStatus;
    onToggleSessions: () => void;
    onToggleFiles: () => void;
    onOpenAgents: () => void;
    /** Whether the file panel can be opened without showing a Project the browser did not choose. */
    filesEnabled?: boolean;
  } = $props();
</script>

<header class="flex min-h-11 items-center border-b border-hairline p-2" data-testid="top-bar">
  <!--
    The controls reach the 44 px tap floor, so each bar pads around them: unpadded, a control's
    border sits on the bar's hairline and reads as part of the bar. That padding is 16 px of vertical
    chrome per row, which the phone pays back out of the transcript.
  -->
  <button
    type="button"
    class="grid size-11 shrink-0 place-items-center rounded border border-hairline-strong text-dim"
    aria-label="Toggle sessions sidebar"
    data-testid="sessions-toggle"
    onclick={onToggleSessions}
  >
    <Icon name="menu" />
  </button>
  <!--
    The wordmark is all caps, and a line box reserves descender room those caps never use, so the ink
    does not sit on the line box's centre even though the box is centred on the row. Trimming the
    line box to cap-height and the alphabetic baseline makes the span's box the ink's box, so the
    row's centring centres what is drawn. Fonts whose ascent and descent differ still line up, which
    a fixed pixel nudge would not; a browser without `text-box` keeps the untrimmed box.
  -->
  <span
    class="ml-3 min-w-0 truncate text-body font-semibold tracking-wide text-dim uppercase [text-box-edge:cap_alphabetic] [text-box-trim:trim-both]"
    data-testid="wordmark">pi-my-ui</span
  >
  <div class="ml-auto flex min-w-0 shrink-0 items-center gap-1">
    <!--
      Files closes the row because it is the control the header's trailing padding has to keep clear
      of the right safe area. The connection status reveals its label to its own left, so it sits
      before Files without anything moving beside it.
    -->
    <ConnectionStatusIndicator {status} />
    <button
      type="button"
      class="grid size-11 shrink-0 place-items-center rounded border border-hairline-strong text-dim disabled:opacity-40"
      aria-label="Files"
      data-testid="files-toggle"
      disabled={!filesEnabled}
      onclick={onToggleFiles}
    >
      <Icon name="folder" />
    </button>
  </div>
</header>

<div
  class="flex min-h-11 items-center gap-2 border-b border-hairline px-3 py-2 text-meta"
  data-testid="session-bar"
>
  <AgentPill {store} onOpen={onOpenAgents} />
  <!--
    The readout's group keeps the row a control tall on its own: the pill is conditional, so without
    this a subagent starting or finishing would resize the chrome above the transcript.
  -->
  <div class="ml-auto flex min-h-11 min-w-0 shrink-0 items-center">
    {#if store.context.usage !== undefined}
      <ContextUsageMeter usage={store.context.usage} />
    {/if}
  </div>
</div>

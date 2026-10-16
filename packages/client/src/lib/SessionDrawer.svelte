<script lang="ts">
  /**
   * The Session drawer: this working directory's Sessions, collapsed by default and an overlay while
   * open. Each row shows the display name and the time since the Session file last changed, and the
   * whole row is the tap target that switches the view. No rename or delete control exists: the list
   * mirrors what pi wrote.
   */
  import type { SessionSummary } from "@pi-my-ui/protocol";

  import { RELATIVE_TIME_REFRESH_MS, formatRelativeTime } from "./sessions/relative-time.js";
  import { sessionDisplayName } from "./store/sessions.svelte.js";

  let {
    summaries,
    activeSessionId,
    onSelect,
    onClose,
  }: {
    summaries: readonly SessionSummary[] | null;
    activeSessionId: string | null;
    onSelect: (sessionId: string) => void;
    onClose: () => void;
  } = $props();

  let nowMs = $state(Date.now());

  // Refresh the labels while the drawer is open, so a visible minute does not go stale without a reload.
  $effect(() => {
    nowMs = Date.now();
    const handle = window.setInterval(() => {
      nowMs = Date.now();
    }, RELATIVE_TIME_REFRESH_MS);
    return () => {
      window.clearInterval(handle);
    };
  });
</script>

<div class="absolute inset-0 z-20 flex">
  <aside
    class="flex w-72 max-w-[80%] flex-col border-r border-neutral-700 bg-neutral-900"
    aria-label="Sessions"
    data-testid="session-drawer"
  >
    <div class="flex items-center border-b border-neutral-800 px-3 py-2">
      <span class="text-xs tracking-wider text-neutral-400 uppercase">Sessions</span>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto" aria-label="Session list">
      {#if summaries === null}
        <p class="px-3 py-4 text-neutral-400" data-testid="session-list-loading">Loading…</p>
      {:else if summaries.length === 0}
        <p class="px-3 py-4 text-neutral-400" data-testid="session-list-empty">No sessions yet.</p>
      {:else}
        <ul data-testid="session-list">
          {#each summaries as summary (summary.id)}
            {@const isCurrent = summary.id === activeSessionId}
            <li class="border-b border-neutral-800">
              <button
                type="button"
                class="flex min-h-11 w-full items-center px-3 py-2 text-left"
                class:bg-neutral-800={isCurrent}
                data-testid="session-row"
                data-session-id={summary.id}
                aria-current={isCurrent ? "true" : undefined}
                onclick={() => onSelect(summary.id)}
              >
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-sm"
                    class:text-neutral-100={isCurrent}
                    class:text-neutral-300={!isCurrent}
                    data-testid="session-name">{sessionDisplayName(summary)}</span
                  >
                  <span class="block truncate text-xs text-neutral-500" data-testid="session-time"
                    >{formatRelativeTime(summary.lastActivityAt, nowMs)}</span
                  >
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </nav>
  </aside>

  <button
    type="button"
    class="flex-1 bg-black/60"
    aria-label="Close sessions sidebar"
    onclick={onClose}
  ></button>
</div>

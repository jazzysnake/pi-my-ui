<script lang="ts">
  /**
   * The Session drawer: this working directory's Sessions, collapsed by default and an overlay while
   * open. Each row shows the display name and the time since the Session file last changed, and the
   * whole row is the tap target that switches the view. No rename or delete control exists: the list
   * mirrors what pi wrote.
   */
  import type { SessionRow } from "./store/sessions.svelte.js";

  import { RELATIVE_TIME_REFRESH_MS, formatRelativeTime } from "./sessions/relative-time.js";
  import { sessionDisplayName } from "./store/sessions.svelte.js";

  let {
    rows,
    activeSessionId,
    onSelect,
    onCreateSession,
    onClose,
  }: {
    rows: readonly SessionRow[] | null;
    activeSessionId: string | null;
    onSelect: (sessionId: string) => void;
    onCreateSession: () => void;
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
      <button
        type="button"
        class="ml-auto flex h-11 w-11 items-center justify-center rounded text-lg text-neutral-300"
        aria-label="New session"
        data-testid="new-session-action"
        onclick={() => onCreateSession()}>+</button
      >
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto" aria-label="Session list">
      {#if rows === null}
        <p class="px-3 py-4 text-neutral-400" data-testid="session-list-loading">Loading…</p>
      {:else if rows.length === 0}
        <p class="px-3 py-4 text-neutral-400" data-testid="session-list-empty">No sessions yet.</p>
      {:else}
        <ul data-testid="session-list">
          {#each rows as row (row.summary.id)}
            {@const isCurrent = row.summary.id === activeSessionId}
            <li class="border-b border-neutral-800">
              <button
                type="button"
                class="flex min-h-11 w-full items-center px-3 py-2 text-left"
                class:bg-neutral-800={isCurrent}
                data-testid="session-row"
                data-session-id={row.summary.id}
                data-activity={row.working ? "working" : "idle"}
                aria-current={isCurrent ? "true" : undefined}
                onclick={() => onSelect(row.summary.id)}
              >
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-sm"
                    class:text-neutral-100={isCurrent}
                    class:text-neutral-300={!isCurrent}
                    data-testid="session-name">{sessionDisplayName(row.summary)}</span
                  >
                  <span class="block truncate text-xs text-neutral-500" data-testid="session-time"
                    >{formatRelativeTime(row.summary.lastActivityAt, nowMs)}</span
                  >
                </span>
                {#if row.working || row.unread}
                  <span
                    class="ml-2 h-2 w-2 shrink-0 rounded-full"
                    class:bg-amber-400={row.working}
                    class:bg-sky-400={!row.working && row.unread}
                    data-testid="activity-dot"
                    data-activity-kind={row.working ? "working" : "unread"}
                    aria-label={row.working ? "Working" : "Unread output"}
                  ></span>
                {/if}
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

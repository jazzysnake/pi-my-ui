<script lang="ts">
  import { AgentListRowKind, buildAgentListRows, type AgentListRow } from "./subagents/rows.js";
  import type { ClientStore } from "./store/client-store.svelte.js";

  let {
    store,
    onSelect,
    onClose,
  }: {
    store: ClientStore;
    /** The agent to focus, or `null` for the Session's own conversation. */
    onSelect: (agentId: string | null) => void;
    onClose: () => void;
  } = $props();

  // Elapsed times read a wall clock that has to move, or a row would show the figure it had when the
  // list opened for as long as it stays open.
  let nowMs = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      nowMs = Date.now();
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  });

  const rows = $derived(
    buildAgentListRows(store.subagents.agents, store.subagents.focusedAgentId, nowMs),
  );

  function rowKey(row: AgentListRow): string {
    return row.kind === AgentListRowKind.Main ? "main" : row.agent.id;
  }
</script>

<div
  class="absolute inset-0 z-40 flex flex-col justify-end bg-black/50"
  role="dialog"
  aria-modal="true"
  aria-label="Agents"
  data-testid="agent-list"
>
  <button
    type="button"
    class="min-h-11 flex-1"
    aria-label="Close agent list"
    data-testid="agent-list-scrim"
    onclick={onClose}
  ></button>
  <div class="max-h-[70dvh] overflow-y-auto border-t border-neutral-800 bg-neutral-950 pb-2">
    <div class="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
      <span class="min-w-0 flex-1 text-xs tracking-wider text-neutral-400 uppercase">Agents</span>
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center rounded border border-neutral-700 text-neutral-300"
        aria-label="Close agent list"
        data-testid="agent-list-close"
        onclick={onClose}
      >
        ×
      </button>
    </div>
    <ul aria-label="Agents and workflow runs">
      {#each rows as row (rowKey(row))}
        <li class="border-b border-neutral-800">
          {#if row.kind === AgentListRowKind.Workflow}
            <div
              class="flex min-h-11 w-full flex-col justify-center gap-0.5 px-3 py-1 text-left"
              data-testid="agent-row"
              data-row-kind="workflow"
              data-agent-id={row.agent.id}
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="shrink-0 rounded border border-neutral-700 px-1 text-[10px] tracking-wider text-neutral-400 uppercase"
                  >workflow</span
                >
                <span class="truncate text-sm" data-testid="agent-row-name">{row.agent.handle}</span
                >
                <span
                  class="ml-auto shrink-0 text-xs text-neutral-400"
                  data-testid="agent-row-elapsed">{row.elapsed ?? ""}</span
                >
              </span>
              <span class="flex min-w-0 items-center gap-2 text-xs">
                <span class="shrink-0 text-neutral-500" data-testid="agent-row-type"
                  >{row.agent.type}</span
                >
                <span class="ml-auto shrink-0 text-neutral-400" data-testid="agent-row-status"
                  >{row.agent.status}</span
                >
              </span>
            </div>
          {:else}
            <button
              type="button"
              class="flex min-h-11 w-full flex-col justify-center gap-0.5 px-3 py-1 text-left"
              data-testid="agent-row"
              data-row-kind={row.kind}
              data-agent-id={row.kind === AgentListRowKind.Main ? "main" : row.agent.id}
              data-focused={row.focused}
              onclick={() => {
                onSelect(row.kind === AgentListRowKind.Main ? null : row.agent.id);
              }}
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="truncate text-sm" data-testid="agent-row-name">
                  {row.kind === AgentListRowKind.Main ? row.label : `@${row.agent.handle}`}
                </span>
                {#if row.focused}
                  <span class="shrink-0 text-xs text-neutral-400" data-testid="agent-row-focused"
                    >focused</span
                  >
                {/if}
                <span
                  class="ml-auto shrink-0 text-xs text-neutral-400"
                  data-testid="agent-row-elapsed"
                  >{row.kind === AgentListRowKind.Agent ? (row.elapsed ?? "") : ""}</span
                >
              </span>
              {#if row.kind === AgentListRowKind.Agent}
                <span class="flex min-w-0 items-center gap-2 text-xs">
                  <span class="shrink-0 text-neutral-500" data-testid="agent-row-type"
                    >{row.agent.type}</span
                  >
                  <span class="ml-auto shrink-0 text-neutral-400" data-testid="agent-row-status"
                    >{row.agent.status}</span
                  >
                </span>
              {/if}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
</div>

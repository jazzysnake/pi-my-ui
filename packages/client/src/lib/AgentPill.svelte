<script lang="ts">
  import { AgentPillKind, deriveAgentPill } from "./subagents/pill.js";
  import type { ClientStore } from "./store/client-store.svelte.js";

  let { store, onOpen }: { store: ClientStore; onOpen: () => void } = $props();

  const pill = $derived(deriveAgentPill(store.subagents.agents, store.subagents.focusedAgentId));
</script>

{#if pill.kind !== AgentPillKind.None}
  <button
    type="button"
    class="min-h-11 min-w-11 max-w-40 shrink-0 truncate rounded-full border border-hairline-strong px-2 text-meta text-dim"
    aria-label="Agents"
    data-testid="agent-pill"
    data-pill-kind={pill.kind}
    onclick={onOpen}
  >
    <span data-testid="agent-pill-label">{pill.label}</span>
  </button>
{/if}

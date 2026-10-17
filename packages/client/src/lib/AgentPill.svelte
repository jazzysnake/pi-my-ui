<script lang="ts">
  import { AgentPillKind, deriveAgentPill } from "./subagents/pill.js";
  import type { ClientStore } from "./store/client-store.svelte.js";

  let { store, onOpen }: { store: ClientStore; onOpen: () => void } = $props();

  const pill = $derived(deriveAgentPill(store.subagents.agents, store.subagents.focusedAgentId));
</script>

{#if pill.kind !== AgentPillKind.None}
  <button
    type="button"
    class="min-h-11 max-w-40 truncate rounded-full border border-neutral-700 px-2 text-xs text-neutral-300"
    aria-label="Agents"
    data-testid="agent-pill"
    data-pill-kind={pill.kind}
    onclick={onOpen}
  >
    <span data-testid="agent-pill-label">{pill.label}</span>
  </button>
{/if}

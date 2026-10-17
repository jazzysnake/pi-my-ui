<script lang="ts">
  import { AgentPillKind, deriveAgentPill } from "./subagents/pill.js";
  import type { ClientStore } from "./store/client-store.svelte.js";

  let { store }: { store: ClientStore } = $props();

  const pill = $derived(deriveAgentPill(store.subagents.agents, store.subagents.focusedAgentId));
</script>

{#if pill.kind !== AgentPillKind.None}
  <div
    class="max-w-40 truncate rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300"
    role="status"
    data-testid="agent-pill"
    data-pill-kind={pill.kind}
  >
    <span data-testid="agent-pill-label">{pill.label}</span>
  </div>
{/if}

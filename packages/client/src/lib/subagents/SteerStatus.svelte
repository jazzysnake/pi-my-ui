<script lang="ts">
  import { steerInFlightText, type SteerTarget } from "../subagents/steering.js";
  import type { SteerInFlight } from "../store/subagents.svelte.js";

  let {
    refusal = null,
    target = null,
    inFlight = null,
  }: {
    /** Why a steer cannot be sent, or `null` when it can. */
    refusal?: string | null;
    target?: SteerTarget | null;
    inFlight?: SteerInFlight | null;
  } = $props();
</script>

{#if refusal !== null}
  <p
    class="text-xs text-amber-400"
    role="status"
    data-testid="steer-refusal"
    data-agent-status={target?.status}
  >
    {refusal}
  </p>
{/if}

{#if inFlight !== null}
  <p
    class="flex min-w-0 items-center gap-2 text-xs text-sky-300"
    role="status"
    data-testid="steer-pending"
    data-steer-agent-id={inFlight.agentId}
  >
    <span class="min-w-0 truncate">{steerInFlightText(inFlight.handle)}</span>
  </p>
{/if}

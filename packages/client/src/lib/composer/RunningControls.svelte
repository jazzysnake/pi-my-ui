<script lang="ts">
  import { StreamingBehavior } from "@pi-my-ui/protocol";

  import Icon from "../Icon.svelte";

  import type { SteerTarget } from "../subagents/steering.js";

  /**
   * The row shown while the Session's own run is streaming. When an agent's conversation is shown, a
   * typed message is a steer instead: pi's steer/follow-up choice does not apply to it, so only the
   * send control is offered.
   */
  let {
    steerTarget = null,
    choice,
    canSend,
    onChoose,
    onSend,
  }: {
    steerTarget?: SteerTarget | null;
    choice: StreamingBehavior;
    canSend: boolean;
    onChoose: (behavior: StreamingBehavior) => void;
    onSend: () => void;
  } = $props();

  const steering = $derived(steerTarget !== null);
</script>

<div class="flex items-center gap-1" role="group" aria-label="While running">
  <span class="shrink-0 text-meta tracking-wider text-faint uppercase">While running</span>
  {#if !steering}
    <button
      type="button"
      class="min-h-11 rounded border px-2 text-meta"
      class:border-ink={choice === StreamingBehavior.Steer}
      class:text-ink={choice === StreamingBehavior.Steer}
      class:border-hairline-strong={choice !== StreamingBehavior.Steer}
      class:text-dim={choice !== StreamingBehavior.Steer}
      aria-pressed={choice === StreamingBehavior.Steer}
      aria-describedby="streaming-choice-hint"
      data-testid="streaming-choice-steer"
      onclick={() => {
        onChoose(StreamingBehavior.Steer);
      }}
    >
      Steer
    </button>
    <button
      type="button"
      class="min-h-11 rounded border px-2 text-meta"
      class:border-ink={choice === StreamingBehavior.FollowUp}
      class:text-ink={choice === StreamingBehavior.FollowUp}
      class:border-hairline-strong={choice !== StreamingBehavior.FollowUp}
      class:text-dim={choice !== StreamingBehavior.FollowUp}
      aria-pressed={choice === StreamingBehavior.FollowUp}
      aria-describedby="streaming-choice-hint"
      data-testid="streaming-choice-follow-up"
      onclick={() => {
        onChoose(StreamingBehavior.FollowUp);
      }}
    >
      Follow up
    </button>
  {/if}
  <button
    type="button"
    class="ml-auto grid size-11 shrink-0 place-items-center rounded-full border border-hairline-strong text-success disabled:opacity-40"
    aria-label="Send while running"
    disabled={!canSend}
    data-testid="composer-send-while-running"
    onclick={onSend}
  >
    <Icon name="arrow-up" />
  </button>
</div>
{#if !steering}
  <p id="streaming-choice-hint" class="text-meta text-faint" data-testid="streaming-choice-hint">
    Steer: goes into this run at its next step · Follow up: waits until this run finishes
  </p>
{/if}

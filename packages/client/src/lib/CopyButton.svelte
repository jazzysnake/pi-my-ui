<script lang="ts">
  import { onDestroy } from "svelte";

  import Icon from "./Icon.svelte";

  /** Long enough for the check to register, short enough not to hide the control's real state. */
  const CONFIRM_MS = 1_400;

  let {
    text,
    label,
    class: className = "",
    testId,
  }: {
    /** A getter defers reading the text to the tap, for a block whose code lives in the DOM. */
    text: string | (() => string);
    label: string;
    class?: string;
    testId?: string;
  } = $props();

  let copied = $state(false);
  let revertTimer: ReturnType<typeof setTimeout> | null = null;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
    } catch {
      return;
    }
    copied = true;
    if (revertTimer !== null) {
      clearTimeout(revertTimer);
    }
    revertTimer = setTimeout(() => {
      copied = false;
      revertTimer = null;
    }, CONFIRM_MS);
  }

  onDestroy(() => {
    if (revertTimer !== null) {
      clearTimeout(revertTimer);
    }
  });
</script>

<button
  type="button"
  class={`grid place-items-center rounded ${copied ? "text-success" : "text-faint"} ${className}`}
  aria-label={label}
  data-testid={testId}
  data-copied={copied}
  onclick={() => {
    void copy();
  }}
>
  {#if copied}
    <Icon name="check" class="size-4" />
  {:else}
    <Icon name="copy" class="size-4" />
  {/if}
</button>
<span class="sr-only" aria-live="polite" data-testid="copy-announcement"
  >{copied ? "Copied" : ""}</span
>

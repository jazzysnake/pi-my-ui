<script lang="ts">
  /**
   * PROTOTYPE — a copy control whose only job is to show placement and the transient "copied"
   * state. The shipped icon set has no check glyph yet, so the tick is drawn here.
   */
  let {
    text,
    label,
    class: className = "",
  }: { text: string; label: string; class?: string } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function copy(): void {
    void navigator.clipboard?.writeText(text);
    copied = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      copied = false;
      timer = null;
    }, 1400);
  }
</script>

<button
  type="button"
  class={`grid place-items-center rounded ${copied ? "text-success" : "text-faint"} ${className}`}
  aria-label={label}
  data-copied={copied}
  onclick={copy}
>
  {#if copied}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-4"
      aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg
    >
  {:else}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-4"
      aria-hidden="true"
      ><rect x="8" y="8" width="12" height="12" rx="2" /><path
        d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
      /></svg
    >
  {/if}
</button>

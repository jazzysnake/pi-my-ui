<script lang="ts">
  import type { ForkMessage } from "@pi-my-ui/protocol";

  let {
    messages,
    onChoose,
    onClose,
  }: {
    /** pi's forkable user messages, or `null` while its answer is in flight. */
    messages: readonly ForkMessage[] | null;
    onChoose: (entryId: string) => void;
    onClose: () => void;
  } = $props();
</script>

<div
  class="absolute inset-0 z-40 flex flex-col bg-canvas text-ink"
  role="dialog"
  aria-modal="true"
  aria-label="Fork from a message"
  data-testid="fork-picker"
>
  <div class="flex items-center gap-2 border-b border-hairline px-3 py-2">
    <span class="min-w-0 flex-1">
      <span class="block text-meta tracking-wider text-dim uppercase">Fork session</span>
      <span class="block truncate text-meta text-faint">Choose a message to fork from</span>
    </span>
    <button
      type="button"
      class="grid size-11 shrink-0 place-items-center rounded border border-hairline-strong text-dim"
      aria-label="Close fork picker"
      data-testid="fork-picker-close"
      onclick={onClose}
    >
      ×
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if messages === null}
      <p class="px-3 py-4 text-dim" data-testid="fork-picker-loading">Loading messages…</p>
    {:else if messages.length === 0}
      <p class="px-3 py-4 text-dim" data-testid="fork-picker-empty">
        There are no user messages to fork from.
      </p>
    {:else}
      <ul aria-label="Forkable messages">
        {#each messages as message (message.entryId)}
          <li class="border-b border-hairline">
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-2 px-3 text-left"
              data-testid="fork-picker-row"
              data-entry-id={message.entryId}
              onclick={() => {
                onChoose(message.entryId);
              }}
            >
              <span class="min-w-0 flex-1 truncate">{message.text}</span>
              <span class="shrink-0 text-meta whitespace-nowrap text-dim">Fork from here</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

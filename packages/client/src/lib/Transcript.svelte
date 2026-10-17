<script lang="ts">
  import { ContentBlockType, MessageRole, type ProjectedEntry } from "@pi-my-ui/protocol";

  import Markdown from "./Markdown.svelte";
  import NotificationCard from "./NotificationCard.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";
  import { entryText } from "./transcript.js";

  let { entries }: { entries: readonly ProjectedEntry[] } = $props();

  let container = $state<HTMLElement | null>(null);
  let pinned = $state(true);

  const NEAR_BOTTOM_PX = 48;

  function handleScroll(): void {
    if (container === null) {
      return;
    }
    pinned =
      container.scrollHeight - container.scrollTop - container.clientHeight <= NEAR_BOTTOM_PX;
  }

  function copyRaw(entry: ProjectedEntry): void {
    void navigator.clipboard.writeText(entryText(entry));
  }

  // Auto-scroll follows the stream only while the reader is already at the bottom; a reader who
  // scrolled up is never yanked back to the newest output.
  $effect(() => {
    const current = entries;
    if (pinned && container !== null) {
      container.scrollTop = current.length > 0 ? container.scrollHeight : 0;
    }
  });

  // The transcript is not the only thing that changes height: the composer above it grows when the
  // status strip arrives or the on-screen keyboard opens, and a reader pinned to the bottom must
  // stay pinned rather than drift below the newest output.
  $effect(() => {
    const element = container;
    if (element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pinned) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  });
</script>

<main
  bind:this={container}
  class="min-h-0 flex-1 overflow-y-auto px-3 py-2"
  data-testid="transcript"
  onscroll={handleScroll}
>
  {#each entries as entry (entry.id)}
    <article
      class="mb-3 last:mb-0"
      data-testid="transcript-entry"
      data-entry-id={entry.id}
      data-role={entry.role}
    >
      {#if entry.role === MessageRole.Notification}
        <NotificationCard {entry} />
      {:else}
        <div class="flex items-start gap-1">
          <div class="min-w-0 flex-1">
            {#each entry.blocks as block, index (index)}
              {#if block.type === ContentBlockType.Text}
                {#if entry.role === MessageRole.Assistant}
                  <Markdown text={block.text} />
                {:else}
                  <p class="text-sm break-words whitespace-pre-wrap">{block.text}</p>
                {/if}
              {:else if block.type === ContentBlockType.Reasoning}
                <details
                  class="mb-1 rounded border border-neutral-800"
                  data-testid="reasoning-block"
                >
                  <summary class="cursor-pointer px-2 py-1 text-xs text-neutral-400"
                    >Thinking</summary
                  >
                  <p class="px-2 pb-2 text-xs break-words whitespace-pre-wrap text-neutral-400">
                    {block.text}
                  </p>
                </details>
              {:else if block.type === ContentBlockType.ToolCall}
                <ToolCallCard {block} />
              {/if}
            {/each}
          </div>
          <button
            type="button"
            class="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-neutral-500"
            aria-label="Copy raw markdown"
            data-testid="copy-raw"
            onclick={() => copyRaw(entry)}
          >
            <svg
              viewBox="0 0 24 24"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h8" />
            </svg>
          </button>
        </div>
      {/if}
    </article>
  {/each}
</main>

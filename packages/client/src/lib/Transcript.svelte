<script lang="ts">
  import { tick } from "svelte";
  import { EntryKind, MessageRole, type ProjectedEntry } from "@pi-my-ui/protocol";

  import CompactionBoundary from "./CompactionBoundary.svelte";
  import MessageCard from "./MessageCard.svelte";
  import NotificationCard from "./NotificationCard.svelte";
  import {
    loadOlderWindow,
    newestWindowPosition,
    windowEntries,
    type TranscriptWindowPosition,
  } from "./transcript-window.js";

  let {
    entries,
    empty = null,
    snapshotCount = 0,
  }: {
    entries: readonly ProjectedEntry[];
    empty?: string | null;
    /** Increments for every Snapshot the store accepts, which is the resync this view anchors. */
    snapshotCount?: number;
  } = $props();

  let position = $state<TranscriptWindowPosition>(newestWindowPosition());
  const mounted = $derived(windowEntries(entries, position));

  let container = $state<HTMLElement | null>(null);
  let pinned = $state(true);

  const NEAR_BOTTOM_PX = 48;

  /** One row at the top of the viewport, remembered across a resync so its pixels can be restored. */
  interface ViewAnchor {
    readonly entryId: string | null;
    readonly offset: number;
  }

  interface SavedView {
    readonly anchor: ViewAnchor;
    readonly pinned: boolean;
  }

  function handleScroll(): void {
    if (container === null) {
      return;
    }
    pinned =
      container.scrollHeight - container.scrollTop - container.clientHeight <= NEAR_BOTTOM_PX;
  }

  function isMessageCard(entry: ProjectedEntry): boolean {
    return entry.kind === EntryKind.Message && entry.role !== MessageRole.Notification;
  }

  /** The first row the reader can see, and how far below the viewport's top edge it starts. */
  function currentAnchor(): ViewAnchor {
    if (container === null) {
      return { entryId: null, offset: 0 };
    }
    const top = container.getBoundingClientRect().top;
    for (const row of container.querySelectorAll<HTMLElement>("[data-entry-id]")) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > top) {
        return { entryId: row.dataset["entryId"] ?? null, offset: rect.top - top };
      }
    }
    return { entryId: null, offset: 0 };
  }

  /** Put the anchored row back where it was, so a replaced Projection does not move the reader. */
  function restoreAnchor(anchor: ViewAnchor): void {
    const element = container;
    if (element === null || anchor.entryId === null) {
      return;
    }
    const row = element.querySelector<HTMLElement>(`[data-entry-id="${anchor.entryId}"]`);
    if (row === null) {
      return;
    }
    const offsetNow = row.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.scrollTop += offsetNow - anchor.offset;
  }

  async function withAnchor(change: () => void): Promise<void> {
    const anchor = currentAnchor();
    change();
    await tick();
    restoreAnchor(anchor);
  }

  function showOlder(): void {
    pinned = false;
    void withAnchor(() => {
      position = loadOlderWindow(entries, position);
    });
  }

  function returnToNewest(): void {
    position = newestWindowPosition();
    pinned = true;
    void tick().then(() => {
      if (container !== null) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  let lastLength = 0;
  let seenSnapshots = 0;
  let pendingSnapshot: SavedView | null = null;

  // A Snapshot replaces every entry id at once. Before the DOM changes, remember the row under the
  // reader's eye and keep the same absolute range mounted, so the replacement does not jump them.
  $effect.pre(() => {
    const count = snapshotCount;
    if (count === seenSnapshots) {
      return;
    }
    seenSnapshots = count;
    if (lastLength === 0) {
      // The first Snapshot fills an empty view; there is no range to preserve yet.
      position = newestWindowPosition();
      lastLength = entries.length;
      return;
    }
    const oldStart = Math.max(0, lastLength - position.hiddenNewer - position.size);
    const oldSize = Math.min(position.size, Math.max(0, lastLength - oldStart));
    pendingSnapshot = { anchor: currentAnchor(), pinned };
    // Only a window that already hid older rows needs its absolute range kept. A short transcript
    // has nothing above it to preserve, so it shows the whole replacement.
    position =
      pinned || oldStart === 0
        ? {
            size: Math.max(oldSize, Math.min(entries.length, position.size)),
            hiddenNewer: 0,
          }
        : {
            size: oldSize,
            hiddenNewer: Math.max(0, entries.length - (oldStart + oldSize)),
          };
    lastLength = entries.length;
  });

  $effect(() => {
    void snapshotCount;
    const saved = pendingSnapshot;
    pendingSnapshot = null;
    if (saved === null || saved.pinned) {
      return;
    }
    void tick().then(() => {
      restoreAnchor(saved.anchor);
    });
  });

  // New output grows the transcript below the reader. While following the bottom the window slides
  // with it; a reader who scrolled up keeps their range and the new output becomes "newer".
  $effect(() => {
    const length = entries.length;
    const added = length - lastLength;
    if (length === 0) {
      position = newestWindowPosition();
      pinned = true;
      lastLength = 0;
      return;
    }
    const hiddenOlder = Math.max(0, lastLength - position.hiddenNewer - position.size);
    if (added > 0 && !pinned && hiddenOlder > 0) {
      position = { size: position.size, hiddenNewer: position.hiddenNewer + added };
    }
    lastLength = length;
  });

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
  {#if entries.length === 0 && empty !== null}
    <p class="text-body text-dim" data-testid="transcript-empty">{empty}</p>
  {/if}
  {#if mounted.hiddenOlder > 0}
    <button
      type="button"
      class="mb-3 min-h-11 w-full rounded border border-hairline-strong px-3 text-meta text-dim"
      data-testid="hidden-older"
      data-hidden-count={mounted.hiddenOlder}
      onclick={showOlder}
    >
      Show {mounted.hiddenOlder} older message{mounted.hiddenOlder === 1 ? "" : "s"}
    </button>
  {/if}
  {#each mounted.visible as entry (entry.id)}
    <article
      class={`last:mb-0 ${isMessageCard(entry) ? "mb-5" : "mb-3"}`}
      data-testid="transcript-entry"
      data-entry-id={entry.id}
      data-role={entry.kind === EntryKind.Message ? entry.role : entry.kind}
    >
      {#if entry.kind === EntryKind.CompactionBoundary}
        <CompactionBoundary {entry} />
      {:else if entry.role === MessageRole.Notification}
        <NotificationCard {entry} />
      {:else}
        <MessageCard {entry} />
      {/if}
    </article>
  {/each}
  {#if mounted.hiddenNewer > 0}
    <button
      type="button"
      class="mt-3 min-h-11 w-full rounded border border-hairline-strong px-3 text-meta text-dim"
      data-testid="hidden-newer"
      data-hidden-count={mounted.hiddenNewer}
      onclick={returnToNewest}
    >
      {mounted.hiddenNewer} newer message{mounted.hiddenNewer === 1 ? "" : "s"} hidden · return to newest
    </button>
  {/if}
</main>

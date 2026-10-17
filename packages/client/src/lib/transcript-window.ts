/**
 * The transcript's mounted range. Entries are variable-height (markdown, code blocks, tool cards), so
 * a height-estimating virtual scroller would need a measurement pass of its own. A window with a
 * bounded size keeps the DOM small, and shifting it backwards is what makes older entries reachable
 * without ever mounting the whole Session.
 */

import type { ProjectedEntry } from "@pi-my-ui/protocol";

/** Taller than a phone viewport, so the reader can still scroll back within the window. */
export const TRANSCRIPT_WINDOW_SIZE = 60;
/** How many more rows one "older" request adds before the window starts moving instead. */
export const TRANSCRIPT_WINDOW_STEP = 60;
/** The ceiling on mounted rows: past this the window moves rather than growing. */
export const TRANSCRIPT_WINDOW_MAX = 240;

/** Where the mounted range sits: its size, and how many newest entries it hides below. */
export interface TranscriptWindowPosition {
  readonly size: number;
  readonly hiddenNewer: number;
}

export interface TranscriptWindow {
  readonly visible: readonly ProjectedEntry[];
  /** Entries above the mounted range, reachable by loading older. */
  readonly hiddenOlder: number;
  /** Entries below the mounted range, reachable by returning to the newest output. */
  readonly hiddenNewer: number;
}

/** The starting range: the newest page, with nothing hidden below it. */
export function newestWindowPosition(): TranscriptWindowPosition {
  return { size: TRANSCRIPT_WINDOW_SIZE, hiddenNewer: 0 };
}

/** The mounted slice for one position, clamped to what the transcript actually holds. */
export function windowEntries(
  entries: readonly ProjectedEntry[],
  position: TranscriptWindowPosition = newestWindowPosition(),
): TranscriptWindow {
  const hiddenNewer = Math.min(Math.max(0, position.hiddenNewer), entries.length);
  const end = entries.length - hiddenNewer;
  const start = Math.max(0, end - position.size);
  return {
    visible: entries.slice(start, end),
    hiddenOlder: start,
    hiddenNewer: entries.length - end,
  };
}

/**
 * One "older" request. The range grows until it reaches the mounted ceiling, then slides backwards:
 * growing forever would mount every entry of a long Session, and sliding replaces the newest rows
 * the reader has already left behind.
 */
export function loadOlderWindow(
  entries: readonly ProjectedEntry[],
  position: TranscriptWindowPosition,
): TranscriptWindowPosition {
  const { visible } = windowEntries(entries, position);
  const mounted = visible.length;
  const hiddenOlder = Math.max(0, entries.length - position.hiddenNewer - mounted);
  if (hiddenOlder === 0) {
    return position;
  }
  if (mounted < TRANSCRIPT_WINDOW_MAX) {
    const grow = Math.min(TRANSCRIPT_WINDOW_STEP, hiddenOlder, TRANSCRIPT_WINDOW_MAX - mounted);
    return { size: mounted + grow, hiddenNewer: position.hiddenNewer };
  }
  const shift = Math.min(TRANSCRIPT_WINDOW_STEP, hiddenOlder);
  const maxHiddenNewer = Math.max(0, entries.length - TRANSCRIPT_WINDOW_MAX);
  return {
    size: TRANSCRIPT_WINDOW_MAX,
    hiddenNewer: Math.min(position.hiddenNewer + shift, maxHiddenNewer),
  };
}

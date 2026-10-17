/**
 * Bounding the transcript's mounted DOM. Entries are variable-height (markdown, code blocks, tool
 * cards), so a height-estimating virtual scroller would need a measurement pass of its own; mounting
 * only the newest slice is the cheaper bound and keeps the newest content always present.
 */

import type { ProjectedEntry } from "@pi-my-ui/protocol";

/** Taller than a phone viewport, so the reader can still scroll back within the window. */
export const TRANSCRIPT_WINDOW_SIZE = 60;

export interface TranscriptWindow {
  readonly visible: readonly ProjectedEntry[];
  readonly hiddenCount: number;
}

export function windowEntries(
  entries: readonly ProjectedEntry[],
  size: number = TRANSCRIPT_WINDOW_SIZE,
): TranscriptWindow {
  if (entries.length <= size) {
    return { visible: entries, hiddenCount: 0 };
  }
  return { visible: entries.slice(entries.length - size), hiddenCount: entries.length - size };
}

/**
 * The one relative-time formatter for the Session list. `nowMs` is a parameter rather than a
 * `Date.now()` read, so the buckets are reproducible in a test.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How often the open drawer re-renders its labels, so a visible minute is at most half a minute old. */
export const RELATIVE_TIME_REFRESH_MS = 30_000;

/** A timestamp ahead of `nowMs` reads `just now` rather than a negative age. */
export function formatRelativeTime(timestampMs: number, nowMs: number): string {
  const elapsedMs = nowMs - timestampMs;
  if (elapsedMs < MINUTE_MS) {
    return "just now";
  }
  if (elapsedMs < HOUR_MS) {
    return `${String(Math.floor(elapsedMs / MINUTE_MS))}m ago`;
  }
  if (elapsedMs < DAY_MS) {
    return `${String(Math.floor(elapsedMs / HOUR_MS))}h ago`;
  }
  return `${String(Math.floor(elapsedMs / DAY_MS))}d ago`;
}

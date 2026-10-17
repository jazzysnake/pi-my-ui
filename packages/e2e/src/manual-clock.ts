import type { ServerClock } from "@pi-my-ui/server";

/**
 * The server's clock, driven by hand.
 *
 * Idle eviction cannot be waited out in real time, so a spec advances this clock instead: `now` and
 * every deadline the server scheduled move together, exactly as Playwright's clock does in the
 * browser. Nothing else about the server is substituted.
 */
export interface ManualClock {
  readonly clock: ServerClock;
  /** Move time forward by `ms`, running every deadline that falls due on the way, in order. */
  advance(ms: number): void;
  now(): number;
}

interface Deadline {
  readonly dueAt: number;
  readonly run: () => void;
  cancelled: boolean;
}

export function createManualClock(startAt: number = Date.now()): ManualClock {
  let current = startAt;
  const deadlines = new Set<Deadline>();

  function nextDue(limit: number): Deadline | undefined {
    let found: Deadline | undefined;
    for (const deadline of deadlines) {
      if (deadline.cancelled || deadline.dueAt > limit) {
        continue;
      }
      if (found === undefined || deadline.dueAt < found.dueAt) {
        found = deadline;
      }
    }
    return found;
  }

  return {
    clock: {
      now: () => current,
      setTimeout(run, delayMs) {
        const deadline: Deadline = { dueAt: current + Math.max(0, delayMs), run, cancelled: false };
        deadlines.add(deadline);
        return {
          cancel() {
            deadline.cancelled = true;
            deadlines.delete(deadline);
          },
        };
      },
    },
    advance(ms) {
      const target = current + ms;
      for (;;) {
        const due = nextDue(target);
        if (due === undefined) {
          break;
        }
        deadlines.delete(due);
        current = due.dueAt;
        due.run();
      }
      current = target;
    },
    now: () => current,
  };
}

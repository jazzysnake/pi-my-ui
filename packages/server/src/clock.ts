/** The server's only source of time, so a test can advance it instead of waiting. */

/** A scheduled callback the server can cancel; `setTimeout` without a platform timer. */
export interface ServerTimer {
  cancel(): void;
}

export interface ServerClock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /**
   * Run `callback` once after `delayMs`. Deadline-based work (idle eviction) is scheduled through the
   * clock rather than a raw timer, so an injected clock moves the deadline and the firing together.
   */
  setTimeout(callback: () => void, delayMs: number): ServerTimer;
}

export const systemClock: ServerClock = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    // A pending eviction must never be the reason the process stays alive.
    timer.unref();
    return {
      cancel() {
        clearTimeout(timer);
      },
    };
  },
};

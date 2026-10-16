/** The server's only source of time, so a test can advance it instead of waiting. */
export interface ServerClock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: ServerClock = {
  now: () => Date.now(),
};

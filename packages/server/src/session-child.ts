/**
 * The one Pi child a Session owns, and the absence of one.
 *
 * A child outlives neither an eviction nor a crash, but the Session does: this module is the small
 * amount of bookkeeping that lets a host ask for a child, be told when the one it had died, and start
 * another from the same Session file. It is a separate module because a Session host that also owned
 * child startup would grow past the point where its own state is worth reading.
 */

import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { PiChildExit } from "@pi-my-ui/protocol";

import {
  startPiChild,
  type PiChild,
  type PiChildLaunch,
  type PiSessionTarget,
} from "./pi-child.js";

export interface SessionChildOptions {
  readonly target: PiSessionTarget;
  readonly launch: PiChildLaunch;
  /** Every event pi emits, for as long as the child that emitted it is the current one. */
  readonly onEvent: (event: JsonAgentSessionEvent) => void;
  /** The child exited without being asked to; the Session has no child until it is restarted. */
  readonly onLost: (exit: PiChildExit) => void;
}

export interface SessionChild {
  /** Whether a child is running right now. */
  readonly running: boolean;
  /** Start a child if none is running, and return it. A failed start is not remembered. */
  ensure(): Promise<PiChild>;
  /** Stop the running child deliberately, so its exit is not reported as a loss. */
  stop(): Promise<void>;
}

/** Which Session a child opens, for an error that names the Session rather than a path alone. */
function describeTarget(target: PiSessionTarget): string {
  return target.kind === "file" ? target.sessionFile : target.sessionId;
}

export function createSessionChild(options: SessionChildOptions): SessionChild {
  let running: PiChild | undefined;
  let starting: Promise<PiChild> | undefined;
  let unsubscribeEvent: (() => void) | undefined;
  let unsubscribeExit: (() => void) | undefined;
  /** Bumped by every stop, so a start that lands after one cannot claim the Session. */
  let generation = 0;

  function forget(): void {
    unsubscribeEvent?.();
    unsubscribeEvent = undefined;
    unsubscribeExit?.();
    unsubscribeExit = undefined;
    running = undefined;
  }

  /** A child that exited on its own leaves the Session with none, so a later `ensure` starts one. */
  function onLost(pi: PiChild, exit: PiChildExit): void {
    if (running !== pi) {
      return;
    }
    forget();
    options.onLost(exit);
  }

  async function start(): Promise<PiChild> {
    const mine = generation;
    const pi = await startPiChild(options.target, options.launch);
    if (mine !== generation) {
      await pi.stop().catch(() => undefined);
      throw new Error(
        `the Pi child for session ${describeTarget(options.target)} was stopped while it started`,
      );
    }
    running = pi;
    unsubscribeEvent = pi.onEvent(options.onEvent);
    unsubscribeExit = pi.onExit((exit) => {
      onLost(pi, exit);
    });
    return pi;
  }

  return {
    get running() {
      return running !== undefined;
    },
    ensure() {
      if (running !== undefined) {
        return Promise.resolve(running);
      }
      // A child that failed to start must not be remembered: the next request retries rather than
      // replaying the first failure for the life of the server.
      starting ??= start().catch((error: unknown) => {
        starting = undefined;
        throw error;
      });
      return starting;
    },
    async stop() {
      const current = running;
      const pending = starting;
      generation += 1;
      starting = undefined;
      forget();
      // A child still starting is a process pi already spawned, so the stop waits for it rather than
      // leaving it behind.
      const child = current ?? (await pending?.catch(() => undefined));
      await child?.stop().catch(() => undefined);
    },
  };
}

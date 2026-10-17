/**
 * A Session-creating mutation, which pi implements as one command that writes a new Session file and
 * rebinds the child that asked for it. The Session that asked therefore loses its child to another
 * Session, so it is rebuilt from its own file, which the mutation never writes. That rebuild is what
 * keeps the original unchanged and the two Sessions on separate children.
 */

import type { ForkMessage } from "@pi-my-ui/protocol";

import type { PiChild, PiSessionMutation } from "./pi-child.js";

/** A mutation's outcome: the Session it created, or an extension's veto before anything happened. */
export type SessionMutationOutcome =
  { readonly kind: "created"; readonly sessionId: string } | { readonly kind: "cancelled" };

/** What a mutation needs from the Session it runs on. */
export interface SessionMutationHost {
  /** The Session running the mutation, which must keep its identity. */
  readonly sessionId: string;
  /** Make the Session servable, so a child exists to ask. */
  prepare(): Promise<void>;
  child(): Promise<PiChild>;
  /** Stop the rebound child, so no further event from the new Session reaches this one. */
  stopChild(): Promise<void>;
  /** Rebuild this Session's Projection from its own file, having stopped the rebound child. */
  rebuild(): Promise<void>;
  /** Hold this Projection's intake while the child's events describe the new Session. */
  holdEvents(held: boolean): void;
  /** Record that the Session is in use, so its idle window starts now. */
  touch(): void;
}

export interface SessionMutations {
  /** The user messages a fork can start from, in pi's order. */
  forkMessages(): Promise<readonly ForkMessage[]>;
  /** Create a new Session branching from `entryId`, leaving this one as it stands. */
  fork(entryId: string): Promise<SessionMutationOutcome>;
  /** Copy this Session's active branch into a new Session, leaving this one as it stands. */
  clone(): Promise<SessionMutationOutcome>;
}

export function createSessionMutations(host: SessionMutationHost): SessionMutations {
  async function mutate(
    run: (pi: PiChild) => Promise<PiSessionMutation>,
  ): Promise<SessionMutationOutcome> {
    await host.prepare();
    host.holdEvents(true);
    try {
      const pi = await host.child();
      const result = await run(pi);
      if (result.cancelled) {
        return { kind: "cancelled" };
      }
      // Read the id back rather than assume it: the new Session is pi's, and the file it wrote is
      // the only thing that serves it from now on.
      const sessionId = await pi.sessionId();
      if (sessionId === host.sessionId) {
        throw new Error("pi completed a Session mutation but the child kept its own Session");
      }
      await host.stopChild();
      host.holdEvents(false);
      await host.rebuild();
      return { kind: "created", sessionId };
    } finally {
      host.holdEvents(false);
      host.touch();
    }
  }

  return {
    async forkMessages() {
      await host.prepare();
      host.touch();
      return await (await host.child()).forkMessages();
    },
    fork: (entryId) => mutate((pi) => pi.fork(entryId)),
    clone: () => mutate((pi) => pi.clone()),
  };
}

/**
 * One Session as the server holds it: a lazily started Pi child, the live Projection built from its
 * events, and the viewers that receive the Projection's Deltas. Every Pi child is addressed by the
 * Session file it owns, so no two children can write one file.
 */

import {
  ServerMessageType,
  type DeltaMessage,
  type ProjectionDelta,
  type ServerMessage,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { startPiChild, type PiChild, type PiChildLaunch } from "./pi-child.js";
import { createSessionProjectionMachine } from "./session-projection.js";

/** A recipient of one Session's Snapshot and Deltas; the connection implements it over its socket. */
export interface SessionViewer {
  onMessage(message: ServerMessage): void;
}

export interface SessionHost {
  readonly sessionId: string;
  readonly sessionFile: string;
  /** Send the current Snapshot and start receiving Deltas; returns a detach. */
  attach(viewer: SessionViewer): Promise<() => void>;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

export interface SessionHostOptions {
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly launch: PiChildLaunch;
}

export function createSessionHost(options: SessionHostOptions): SessionHost {
  const machine = createSessionProjectionMachine(options.sessionId, options.launch.cwd);
  const viewers = new Set<SessionViewer>();
  let starting: Promise<PiChild> | undefined;
  let unsubscribe: (() => void) | undefined;
  let seeding: Promise<void> | undefined;
  let seeded = false;
  let cursor = 0;
  /** Events delivered while the seed reads pi; applied once the Projection exists, never dropped. */
  let buffering: JsonAgentSessionEvent[] | null = null;

  function publish(deltas: readonly ProjectionDelta[]): void {
    if (deltas.length === 0 || !seeded) {
      return;
    }
    const from = cursor;
    cursor += deltas.length;
    const message: DeltaMessage = {
      type: ServerMessageType.Delta,
      sessionId: options.sessionId,
      fromCursor: from,
      cursor,
      deltas,
    };
    for (const viewer of [...viewers]) {
      viewer.onMessage(message);
    }
  }

  function onEvent(event: JsonAgentSessionEvent): void {
    if (buffering !== null) {
      buffering.push(event);
      return;
    }
    publish(machine.applyEvent(event));
  }

  function ensureChild(): Promise<PiChild> {
    // A child that failed to start must not be remembered: the next request retries rather than
    // replaying the first failure for the life of the server.
    starting ??= startPiChild(options.sessionFile, options.launch)
      .then((pi) => {
        unsubscribe = pi.onEvent(onEvent);
        return pi;
      })
      .catch((error: unknown) => {
        starting = undefined;
        throw error;
      });
    return starting;
  }

  async function doSeed(): Promise<void> {
    buffering = [];
    try {
      const pi = await ensureChild();
      const { entries, leafId } = await pi.entries();
      cursor = machine.seed(entries, leafId);
      seeded = true;
    } finally {
      const queued = buffering;
      buffering = null;
      if (queued !== null) {
        for (const event of queued) {
          publish(machine.applyEvent(event));
        }
      }
    }
  }

  function ensureSeeded(): Promise<void> {
    if (seeded) {
      return Promise.resolve();
    }
    seeding ??= doSeed();
    return seeding;
  }

  function snapshot(): SnapshotMessage {
    return {
      type: ServerMessageType.Snapshot,
      sessionId: options.sessionId,
      cursor,
      projection: machine.projection,
    };
  }

  return {
    sessionId: options.sessionId,
    sessionFile: options.sessionFile,
    async attach(viewer) {
      await ensureSeeded();
      // Registering after the synchronous send keeps the Snapshot ahead of every Delta that follows.
      viewer.onMessage(snapshot());
      viewers.add(viewer);
      return () => {
        viewers.delete(viewer);
      };
    },
    async prompt(text) {
      await ensureSeeded();
      const pi = await ensureChild();
      await pi.prompt(text);
    },
    async abort() {
      await ensureSeeded();
      publish(machine.markAborted());
      const pi = await ensureChild();
      await pi.abort();
    },
    async close() {
      viewers.clear();
      unsubscribe?.();
      unsubscribe = undefined;
      const pending = starting;
      starting = undefined;
      if (pending !== undefined) {
        await (await pending).stop().catch(() => undefined);
      }
    },
  };
}

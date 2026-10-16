/**
 * One Session as the server holds it: a lazily started Pi child and the Projection built from its
 * entries. Every Pi child is addressed by the Session file it owns, so no two children can write
 * one file.
 */

import { ServerMessageType, reduceDeltaBatch, type SnapshotMessage } from "@pi-my-ui/protocol";

import { startPiChild, type PiChild, type PiChildLaunch } from "./pi-child.js";
import { projectionBatch } from "./projection.js";

export interface SessionHost {
  readonly sessionId: string;
  readonly sessionFile: string;
  snapshot(): Promise<SnapshotMessage>;
  close(): Promise<void>;
}

export interface SessionHostOptions {
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly launch: PiChildLaunch;
}

export function createSessionHost(options: SessionHostOptions): SessionHost {
  let child: Promise<PiChild> | undefined;

  function ensureChild(): Promise<PiChild> {
    // A child that failed to start must not be remembered: the next request retries rather than
    // replaying the first failure for the life of the server.
    child ??= startPiChild(options.sessionFile, options.launch).catch((error: unknown) => {
      child = undefined;
      throw error;
    });
    return child;
  }

  return {
    sessionId: options.sessionId,
    sessionFile: options.sessionFile,
    async snapshot() {
      const pi = await ensureChild();
      const { entries, leafId } = await pi.entries();
      const batch = projectionBatch({ entries, leafId, fromCursor: 0 });
      const projection = reduceDeltaBatch(
        {
          sessionId: options.sessionId,
          cwd: options.launch.cwd,
          leafId: null,
          entries: [],
        },
        batch,
      );
      return {
        type: ServerMessageType.Snapshot,
        sessionId: options.sessionId,
        cursor: batch.cursor,
        projection,
      };
    },
    async close() {
      const starting = child;
      child = undefined;
      if (starting !== undefined) {
        await (await starting).stop();
      }
    },
  };
}

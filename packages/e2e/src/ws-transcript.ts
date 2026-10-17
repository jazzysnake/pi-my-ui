/** Session-level frames that are not transcript state, so a transcript reader skips them. */
const NOT_TRANSCRIPT_STATE = new Set(["sessions", "settings", "commands", "contextUsage"]);

/**
 * Reading a projected transcript off a real WebSocket client, so a spec can wait for a run to land
 * instead of sleeping and hoping. Nothing here stands in for the transport or for pi.
 */

import {
  EntryKind,
  ProjectionDeltaKind,
  type DeltaMessage,
  type ProjectedEntry,
  type ServerMessage,
} from "@pi-my-ui/protocol";

import type { WsSessionClient } from "./ws-session-client.js";

/** Every text block of every message entry, in order; a compaction boundary has none. */
export function projectionText(entries: readonly ProjectedEntry[]): string {
  return entries
    .flatMap((entry) => (entry.kind === EntryKind.Message ? entry.blocks : []))
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ");
}

/** The text an upsert Delta adds. */
export function deltaText(message: DeltaMessage): string {
  return message.deltas
    .map((delta) =>
      delta.kind === ProjectionDeltaKind.EntryUpsert ? projectionText([delta.entry]) : "",
    )
    .join(" ");
}

/**
 * Read Deltas until one carries `text`, returning everything read. A Snapshot that already carries
 * the text also ends the wait; any other Snapshot means the read started before the run.
 */
export async function readUntilText(
  client: WsSessionClient,
  text: string,
  initial: readonly DeltaMessage[] = [],
): Promise<readonly DeltaMessage[]> {
  const seen = [...initial];
  for (;;) {
    if (seen.some((message) => deltaText(message).includes(text))) {
      return seen;
    }
    const message: ServerMessage = await client.next();
    if (message.type === "delta") {
      seen.push(message);
      continue;
    }
    // Settings and the Session list are not transcript state, so a run that lands across one still
    // reads cleanly. The palette's commands are read on attach for the same reason.
    if (NOT_TRANSCRIPT_STATE.has(message.type)) {
      continue;
    }
    if (message.type === "snapshot") {
      if (projectionText(message.projection.entries).includes(text)) {
        return seen;
      }
      throw new Error("the Snapshot arrived before the expected output");
    }
    throw new Error(`unexpected server message: ${JSON.stringify(message)}`);
  }
}

/**
 * The next Delta frame, skipping the Session list and Settings that are not transcript state. An
 * activity change lets the server push a list frame ahead of a replay, so a reader that only cares
 * about the transcript must not treat that as the answer.
 */
export async function nextDelta(client: WsSessionClient): Promise<DeltaMessage> {
  for (;;) {
    const message = await client.next();
    if (message.type === "delta") {
      return message;
    }
    if (NOT_TRANSCRIPT_STATE.has(message.type)) {
      continue;
    }
    throw new Error(`expected a Delta but received ${message.type}`);
  }
}

/**
 * The non-transcript frames a subscribe sends after its Snapshot: the Session's Settings, its
 * discoverable Commands and its context figure. A caller reads all three so the next frame it sees
 * is the answer it asked for.
 */
export async function readAttachSurfaces(client: WsSessionClient): Promise<void> {
  const expected = new Set(["settings", "commands", "contextUsage"]);
  while (expected.size > 0) {
    const message = await client.next();
    if (expected.delete(message.type)) {
      continue;
    }
    throw new Error(`expected an attach surface but received ${message.type}`);
  }
}

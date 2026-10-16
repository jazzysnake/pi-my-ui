/**
 * Reading a projected transcript off a real WebSocket client, so a spec can wait for a run to land
 * instead of sleeping and hoping. Nothing here stands in for the transport or for pi.
 */

import {
  ProjectionDeltaKind,
  type DeltaMessage,
  type ProjectedEntry,
  type ServerMessage,
} from "@pi-my-ui/protocol";

import type { WsSessionClient } from "./ws-session-client.js";

/** Every text block of every entry, in order. */
export function projectionText(entries: readonly ProjectedEntry[]): string {
  return entries
    .flatMap((entry) => entry.blocks)
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
    if (message.type === "snapshot") {
      if (projectionText(message.projection.entries).includes(text)) {
        return seen;
      }
      throw new Error("the Snapshot arrived before the expected output");
    }
    throw new Error(`unexpected server message: ${JSON.stringify(message)}`);
  }
}

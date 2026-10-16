/**
 * Every message that crosses the WebSocket, defined once. Client and server ship together, so there
 * is no version field and no negotiation.
 */

import { ClientMessageType, ServerMessageType } from "./constants.js";
import type { Cursor, DeltaBatch, SessionProjection } from "./model.js";
import type { ProtocolErrorInfo } from "./errors.js";

/** Identify the Session to watch, and the Cursor the browser already holds when it has one. */
export interface SubscribeMessage {
  readonly type: typeof ClientMessageType.Subscribe;
  readonly sessionId: string;
  readonly cursor?: Cursor;
}

export type ClientMessage = SubscribeMessage;

/** A full Projection at a Cursor. */
export interface SnapshotMessage {
  readonly type: typeof ServerMessageType.Snapshot;
  readonly sessionId: string;
  readonly cursor: Cursor;
  readonly projection: SessionProjection;
}

/** A cursor-addressed batch of Deltas. */
export interface DeltaMessage extends DeltaBatch {
  readonly type: typeof ServerMessageType.Delta;
  readonly sessionId: string;
}

/** A typed failure, carrying the code the client branches on. */
export interface ErrorMessage {
  readonly type: typeof ServerMessageType.Error;
  readonly error: ProtocolErrorInfo;
}

export type ServerMessage = SnapshotMessage | DeltaMessage | ErrorMessage;

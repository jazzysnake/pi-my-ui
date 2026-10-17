/**
 * The bridge wire: the records a Pi child's bridge extension and the server exchange over their
 * user-only Unix socket.
 *
 * The bridge is the only channel that reaches past pi's RPC. This module is the single definition of
 * that wire, so the extension and the server cannot drift into two spellings of the same record.
 * There is no protocol version: both ends ship together, so a change is made on both sides in one
 * commit.
 */

import { SubagentStatus } from "./subagents.js";

/**
 * Environment variable the server sets on each spawned child; the bridge extension reads it to find
 * the socket. Defined here so the setter and the reader cannot drift.
 */
export const BRIDGE_SOCKET_ENV_VAR = "PI_MY_UI_BRIDGE_SOCKET";

/** `type` discriminants on the bridge wire. */
export const BridgeRecordType = {
  Hello: "hello",
  HelloAck: "helloAck",
  Agent: "agent",
} as const;

export type BridgeRecordType = (typeof BridgeRecordType)[keyof typeof BridgeRecordType];

/** The closed set of bridge wire failure codes. */
export const BridgeErrorCode = {
  /** A field is missing or has the wrong JSON type. */
  MalformedPayload: "malformedPayload",
  /** The claimed Session is not one this server is starting a child for. */
  ForeignConnection: "foreignConnection",
} as const;

export type BridgeErrorCode = (typeof BridgeErrorCode)[keyof typeof BridgeErrorCode];

/** The wire form of a bridge failure, carried in a rejected `helloAck`. */
export interface BridgeErrorInfo {
  readonly code: BridgeErrorCode;
  readonly message: string;
}

/** A typed failure on the bridge wire. */
export class BridgeProtocolError extends Error {
  public override readonly name: string = "BridgeProtocolError";

  public constructor(
    public readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
  }

  public toInfo(): BridgeErrorInfo {
    return { code: this.code, message: this.message };
  }
}

/** The first record a child's bridge sends. */
export interface BridgeHelloRecord {
  readonly type: typeof BridgeRecordType.Hello;
  /** pi's Session id for the child (`ctx.sessionManager.getSessionId()`). */
  readonly sessionId: string;
  /** The child process's pid, for the server's log line. */
  readonly pid: number;
}

/** The server's single answer to a `hello`. */
export interface BridgeHelloAckRecord {
  readonly type: typeof BridgeRecordType.HelloAck;
  readonly ok: boolean;
  /** Present when `ok` is false. */
  readonly error?: BridgeErrorInfo;
}

/** Every record a child's bridge sends. */
export type BridgeChildRecord = BridgeHelloRecord | BridgeAgentRecord;

/** Every record the server sends. */
export type BridgeServerRecord = BridgeHelloAckRecord;

/** Every bridge record, in either direction. */
export type BridgeRecord = BridgeChildRecord | BridgeServerRecord;

/** One record as a JSONL frame. */
export function encodeBridgeRecord(record: BridgeRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function malformed(message: string): never {
  throw new BridgeProtocolError(BridgeErrorCode.MalformedPayload, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    malformed("a bridge record must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/** Parse the handshake a child's bridge must send before any other record. */
export function parseBridgeHello(value: unknown): BridgeHelloRecord {
  const record = asRecord(value);
  if (record["type"] !== BridgeRecordType.Hello) {
    malformed(`expected a ${BridgeRecordType.Hello} record`);
  }
  const sessionId = record["sessionId"];
  if (typeof sessionId !== "string" || sessionId === "") {
    malformed('"sessionId" must be a non-empty string');
  }
  const pid = record["pid"];
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    malformed('"pid" must be a positive integer');
  }
  return { type: BridgeRecordType.Hello, sessionId, pid };
}

/** Parse the server's answer to a `hello`. */
export function parseBridgeHelloAck(value: unknown): BridgeHelloAckRecord {
  const record = asRecord(value);
  if (record["type"] !== BridgeRecordType.HelloAck) {
    malformed(`expected a ${BridgeRecordType.HelloAck} record`);
  }
  const ok = record["ok"];
  if (typeof ok !== "boolean") {
    malformed('"ok" must be a boolean');
  }
  if (ok) {
    return { type: BridgeRecordType.HelloAck, ok: true };
  }
  return { type: BridgeRecordType.HelloAck, ok: false, error: requireError(record["error"]) };
}

function requireError(value: unknown): BridgeErrorInfo {
  const record = asRecord(value);
  const code = record["code"];
  if (code !== BridgeErrorCode.MalformedPayload && code !== BridgeErrorCode.ForeignConnection) {
    malformed('"error.code" must be a known bridge error code');
  }
  const message = record["message"];
  if (typeof message !== "string" || message === "") {
    malformed('"error.message" must be a non-empty string');
  }
  return { code, message };
}

/**
 * One subagent's current state, sent whenever pi-subagents reports a transition. The record carries
 * the whole agent rather than a patch, so a receiver that missed an earlier record still converges.
 */
export interface BridgeAgentRecord {
  readonly type: typeof BridgeRecordType.Agent;
  readonly id: string;
  /** The handle the user types to address the agent; never empty. */
  readonly handle: string;
  readonly status: SubagentStatus;
}

const SUBAGENT_STATUSES: readonly string[] = Object.values(SubagentStatus);

/** Parse one post-handshake agent record. */
export function parseBridgeAgent(value: unknown): BridgeAgentRecord {
  const record = asRecord(value);
  if (record["type"] !== BridgeRecordType.Agent) {
    malformed(`expected a ${BridgeRecordType.Agent} record`);
  }
  const id = record["id"];
  if (typeof id !== "string" || id === "") {
    malformed('"id" must be a non-empty string');
  }
  const handle = record["handle"];
  if (typeof handle !== "string" || handle === "") {
    malformed('"handle" must be a non-empty string');
  }
  const status = record["status"];
  if (typeof status !== "string" || !SUBAGENT_STATUSES.includes(status)) {
    malformed('"status" must be a known subagent status');
  }
  return { type: BridgeRecordType.Agent, id, handle, status: status as SubagentStatus };
}

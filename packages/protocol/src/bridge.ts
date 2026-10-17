/**
 * The bridge wire: the records a Pi child's bridge extension and the server exchange over their
 * user-only Unix socket.
 *
 * The bridge is the only channel that reaches past pi's RPC. This module is the single definition of
 * that wire, so the extension and the server cannot drift into two spellings of the same record.
 * There is no protocol version: both ends ship together, so a change is made on both sides in one
 * commit.
 */

import { SubagentRunKind, SubagentStatus, type SubagentAgent } from "./subagents.js";

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
  Transcript: "transcript",
  Steer: "steer",
  SteerResult: "steerResult",
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

/** The server's request to steer one agent; `requestId` correlates the child's answer. */
export interface BridgeSteerRecord {
  readonly type: typeof BridgeRecordType.Steer;
  readonly requestId: string;
  /** The manager id of the agent to steer, as the agent records carry it. */
  readonly agentId: string;
  readonly message: string;
}

/** The child's answer to one steer request. */
export interface BridgeSteerResultRecord {
  readonly type: typeof BridgeRecordType.SteerResult;
  readonly requestId: string;
  readonly ok: boolean;
  /** Present when `ok` is false. */
  readonly error?: string;
}

/**
 * The bridge's answer to one steer. It says pi accepted the message for delivery, not that the agent
 * has read it: pi queues a steer until the running turn finishes its current tool call.
 */
export interface BridgeSteerOutcome {
  readonly ok: boolean;
  /** Present when `ok` is false; the steering subsystem's own reason. */
  readonly error?: string;
}

/** Every record a child's bridge sends. */
export type BridgeChildRecord =
  BridgeHelloRecord | BridgeAgentRecord | BridgeTranscriptRecord | BridgeSteerResultRecord;

/** Every record the server sends. */
export type BridgeServerRecord = BridgeHelloAckRecord | BridgeSteerRecord;

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
  /** pi's agent type; the row shows it beside the handle. */
  readonly agentType: string;
  readonly status: SubagentStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
}

const SUBAGENT_STATUSES: readonly string[] = Object.values(SubagentStatus);

function optionalTimestamp(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    malformed(`"${field}" must be a non-negative number when present`);
  }
  return value;
}

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
  const agentType = record["agentType"];
  if (typeof agentType !== "string" || agentType === "") {
    malformed('"agentType" must be a non-empty string');
  }
  const status = record["status"];
  if (typeof status !== "string" || !SUBAGENT_STATUSES.includes(status)) {
    malformed('"status" must be a known subagent status');
  }
  const startedAt = optionalTimestamp(record, "startedAt");
  const finishedAt = optionalTimestamp(record, "finishedAt");
  return {
    type: BridgeRecordType.Agent,
    id,
    handle,
    agentType,
    status: status as SubagentStatus,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
  };
}

/** The run kind every record on this wire is: the bridge observes agents, never workflow runs. */
export const BRIDGE_AGENT_RUN_KIND = SubagentRunKind.Agent;

/**
 * The events of an agent's own session that carry its conversation. The transcript is built from
 * whole messages and the pieces between them; every other event an `AgentSession` emits is about a
 * run, and a subagent's run state reaches the Projection as an agent record instead.
 */
export const SUBAGENT_TRANSCRIPT_EVENT_TYPES = [
  "message_start",
  "message_update",
  "message_end",
] as const;

/**
 * One event from a running subagent's conversation. The payload is pi's own session event, carried
 * opaquely: the protocol describes this wire, and pi's message shapes are not its to restate. The
 * server reduces the event with the same code it reduces the Session's own events with.
 */
export interface BridgeTranscriptRecord {
  readonly type: typeof BridgeRecordType.Transcript;
  readonly agentId: string;
  readonly event: Readonly<Record<string, unknown>>;
}

/** The exported tuple, typed for a lookup: a wire value is a `string`, not a literal union. */
const TRANSCRIPT_EVENT_TYPES: readonly string[] = SUBAGENT_TRANSCRIPT_EVENT_TYPES;

/**
 * A message must be an object the projection can read: it switches on `role` and iterates `content`.
 * A record that says the transcript carries a message but sends something else is refused here, where
 * the peer can be told, rather than throwing deep inside a projection.
 */
function requireMessage(value: unknown): void {
  const message = asRecord(value);
  const role = message["role"];
  if (typeof role !== "string" || role === "") {
    malformed('"event.message.role" must be a non-empty string');
  }
  const content = message["content"];
  if (content !== undefined && typeof content !== "string" && !Array.isArray(content)) {
    malformed('"event.message.content" must be a string or an array when present');
  }
}

/** A streaming update must describe a block the projection can place, and a call it can attach. */
function requireUpdate(value: unknown): void {
  const update = asRecord(value);
  const type = update["type"];
  if (typeof type !== "string" || type === "") {
    malformed('"event.assistantMessageEvent.type" must be a non-empty string');
  }
  if (type === "toolcall_end") {
    asRecord(update["toolCall"]);
  }
}

/** Parse one post-handshake transcript record. */
export function parseBridgeTranscript(value: unknown): BridgeTranscriptRecord {
  const record = asRecord(value);
  if (record["type"] !== BridgeRecordType.Transcript) {
    malformed(`expected a ${BridgeRecordType.Transcript} record`);
  }
  const agentId = record["agentId"];
  if (typeof agentId !== "string" || agentId === "") {
    malformed('"agentId" must be a non-empty string');
  }
  const event = asRecord(record["event"]);
  const eventType = event["type"];
  if (typeof eventType !== "string" || !TRANSCRIPT_EVENT_TYPES.includes(eventType)) {
    malformed(`"event.type" must be one of ${TRANSCRIPT_EVENT_TYPES.join(", ")}`);
  }
  if (eventType === "message_update") {
    requireUpdate(event["assistantMessageEvent"]);
  } else {
    requireMessage(event["message"]);
  }
  return { type: BridgeRecordType.Transcript, agentId, event };
}

/** Parse the server's `steer` request on the child's side. */
export function parseBridgeSteer(value: unknown): BridgeSteerRecord {
  const record = asRecord(value);
  if (record["type"] !== BridgeRecordType.Steer) {
    malformed(`expected a ${BridgeRecordType.Steer} record`);
  }
  const requestId = record["requestId"];
  if (typeof requestId !== "string" || requestId === "") {
    malformed('"requestId" must be a non-empty string');
  }
  const agentId = record["agentId"];
  if (typeof agentId !== "string" || agentId === "") {
    malformed('"agentId" must be a non-empty string');
  }
  const message = record["message"];
  if (typeof message !== "string" || message.trim() === "") {
    malformed('"message" must be a non-empty string');
  }
  return { type: BridgeRecordType.Steer, requestId, agentId, message };
}

/** Parse the child's `steerResult` answer on the server's side. */
export function parseBridgeSteerResult(value: unknown): BridgeSteerResultRecord {
  const record = asRecord(value);
  if (record["type"] !== BridgeRecordType.SteerResult) {
    malformed(`expected a ${BridgeRecordType.SteerResult} record`);
  }
  const requestId = record["requestId"];
  if (typeof requestId !== "string" || requestId === "") {
    malformed('"requestId" must be a non-empty string');
  }
  const ok = record["ok"];
  if (typeof ok !== "boolean") {
    malformed('"ok" must be a boolean');
  }
  if (ok) {
    return { type: BridgeRecordType.SteerResult, requestId, ok: true };
  }
  const error = record["error"];
  if (typeof error !== "string" || error === "") {
    malformed('"error" must be a non-empty string when the steer failed');
  }
  return { type: BridgeRecordType.SteerResult, requestId, ok: false, error };
}

/**
 * The Projection row for one bridge record: an agent, never a workflow run, because the bridge only
 * ever observes agents.
 */
export function subagentAgentFromBridge(record: BridgeAgentRecord): SubagentAgent {
  return {
    id: record.id,
    handle: record.handle,
    type: record.agentType,
    status: record.status,
    runKind: BRIDGE_AGENT_RUN_KIND,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
  };
}

/**
 * pi-subagents' lifecycle bus, narrowed to the agent records the server projects.
 *
 * The bus is in-process, so the bridge subscribes to it directly. Only the four channels that say
 * something about a top-level agent are read; the spawn/stop/consume RPC channels are deliberately
 * untouched, because the bridge observes agents and never drives them.
 */

import {
  SubagentRunKind,
  SubagentStatus,
  subagentStatusFromPi,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

/** pi-subagents' announcement that a record exists; it carries no status of its own. */
export const SUBAGENTS_CREATED_CHANNEL = "subagents:created";

/** The channels a lifecycle transition can arrive on. */
export const SUBAGENTS_LIFECYCLE_CHANNELS = [
  SUBAGENTS_CREATED_CHANNEL,
  "subagents:started",
  "subagents:completed",
  "subagents:failed",
] as const;

export type SubagentLifecycleChannel = (typeof SUBAGENTS_LIFECYCLE_CHANNELS)[number];

/**
 * The status a channel establishes by itself. `created` establishes none: pi emits it for a fresh
 * spawn and for a resumed one alike, so guessing `queued` there would report a running agent as not
 * yet started. When neither pi's record nor an earlier record knows the status, nothing is sent.
 */
const CHANNEL_STATUS: Readonly<Record<SubagentLifecycleChannel, SubagentStatus | undefined>> = {
  [SUBAGENTS_CREATED_CHANNEL]: undefined,
  "subagents:started": SubagentStatus.Running,
  "subagents:completed": SubagentStatus.Completed,
  "subagents:failed": SubagentStatus.Failed,
};

/** The `Symbol.for` key pi-subagents registers its manager under. */
export const SUBAGENT_MANAGER_SYMBOL_KEY = "pi-subagents:manager";

/** Log prefix for this module, kept beside it so a diagnostic always names what produced it. */
const BRIDGE_LOG_SCOPE = "[pi-my-ui bridge] subagents:";

/** The read-only slice of pi-subagents' manager this bridge reads: one agent's record. */
export interface SubagentManager {
  getRecord(id: string): unknown;
}

/**
 * pi-subagents' manager, when it is installed and active in this session. The registry is untrusted
 * ambient state — absent in a session that excludes the extension — so its shape is checked, never
 * assumed.
 */
export function subagentManager(): SubagentManager | undefined {
  const registry = (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for(SUBAGENT_MANAGER_SYMBOL_KEY)
  ];
  if (typeof registry !== "object" || registry === null) {
    return undefined;
  }
  const getRecord = (registry as { readonly getRecord?: unknown }).getRecord;
  if (typeof getRecord !== "function") {
    return undefined;
  }
  return {
    getRecord(id: string): unknown {
      return (getRecord as (id: string) => unknown).call(registry, id);
    },
  };
}

/** The record fields the bridge reads; the handle is not on any lifecycle event. */
interface ManagerRecord {
  readonly handle: string | undefined;
  readonly alias: string | undefined;
  readonly type: string | undefined;
  readonly status: string | undefined;
  readonly startedAt: number | undefined;
  readonly completedAt: number | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function timestampOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const EMPTY_RECORD: ManagerRecord = {
  handle: undefined,
  alias: undefined,
  type: undefined,
  status: undefined,
  startedAt: undefined,
  completedAt: undefined,
};

function readManagerRecord(
  manager: SubagentManager | undefined,
  id: string,
  log: (line: string) => void,
): ManagerRecord {
  if (manager === undefined) {
    return EMPTY_RECORD;
  }
  let record: unknown;
  try {
    record = manager.getRecord(id);
  } catch (error) {
    log(`${BRIDGE_LOG_SCOPE} reading the record for ${id} failed: ${errorText(error)}`);
    return EMPTY_RECORD;
  }
  if (!isRecord(record)) {
    return EMPTY_RECORD;
  }
  return {
    handle: stringOf(record["handle"]),
    alias: stringOf(record["alias"]),
    type: stringOf(record["type"]),
    status: stringOf(record["status"]),
    startedAt: timestampOf(record["startedAt"]),
    completedAt: timestampOf(record["completedAt"]),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turn one lifecycle event into the agent's current state, or `undefined` when this event says
 * nothing that can be reported honestly (no id, or a status no source knows).
 *
 * The handle comes from pi's own manager record because no lifecycle event carries it; the event's
 * agent type is the fallback for the brief window before that record is readable, since `@type` is
 * how pi-subagents itself resolves an unnamed agent.
 */
export function lifecycleAgent(
  channel: SubagentLifecycleChannel,
  data: unknown,
  previous: (id: string) => SubagentAgent | undefined,
  manager: SubagentManager | undefined,
  log: (line: string) => void,
): SubagentAgent | undefined {
  if (!isRecord(data)) {
    log(`${BRIDGE_LOG_SCOPE} ignoring a ${channel} event that is not an object`);
    return undefined;
  }
  const id = stringOf(data["id"]);
  if (id === undefined) {
    log(`${BRIDGE_LOG_SCOPE} ignoring a ${channel} event with no agent id`);
    return undefined;
  }
  const before = previous(id);
  const record = readManagerRecord(manager, id, log);
  const mapped = subagentStatusFromPi(record.status);
  if (record.status !== undefined && mapped === undefined) {
    log(`${BRIDGE_LOG_SCOPE} unknown status ${JSON.stringify(record.status)} for ${id}`);
  }
  const status = mapped ?? CHANNEL_STATUS[channel] ?? before?.status;
  if (status === undefined) {
    log(`${BRIDGE_LOG_SCOPE} deferring ${channel} for ${id}: no source reported a status`);
    return undefined;
  }
  const startedAt = record.startedAt ?? before?.startedAt;
  const finishedAt = record.completedAt;
  return {
    id,
    handle: record.handle ?? record.alias ?? before?.handle ?? stringOf(data["type"]) ?? id,
    type: record.type ?? before?.type ?? stringOf(data["type"]) ?? id,
    status,
    runKind: SubagentRunKind.Agent,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
  };
}

/**
 * The subagents a Session ran, as the Session's own entries record them.
 *
 * pi-subagents reports a live run on its in-process lifecycle bus, which the bridge forwards while a
 * child is running; nothing remembers those reports after the child is gone. A settled top-level
 * agent is the exception: pi-subagents persists one `subagents:record` entry per settled run, so the
 * Session file a restart reads back still says what the Session did.
 *
 * Only settled runs are listed. A run interrupted by the restart left no record, and reporting it as
 * still running would invent work nobody can observe.
 */

import {
  SubagentRunKind,
  SubagentStatus,
  subagentStatusFromPi,
  type SubagentAgent,
} from "@pi-my-ui/protocol";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** The `customType` pi-subagents gives the entry it persists when a top-level agent settles. */
export const SUBAGENT_RECORD_CUSTOM_TYPE = "subagents:record";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function millisOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function entryTimestamp(entry: SessionEntry): number | undefined {
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The row one persisted record describes, or `undefined` when it carries no agent id: without an id
 * the row cannot be focused, so a record without one names no run this UI can open.
 */
function recordRow(data: unknown, entry: SessionEntry): SubagentAgent | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const id = stringOf(data["id"]);
  if (id === undefined) {
    return undefined;
  }
  const type = stringOf(data["type"]) ?? id;
  const rawStatus = stringOf(data["status"]);
  const startedAt = millisOf(data["startedAt"]) ?? entryTimestamp(entry);
  const finishedAt = millisOf(data["completedAt"]);
  return {
    id,
    // The record carries no handle, and pi-subagents derives the live one from the agent type, so
    // the type is the handle this agent already had while it ran.
    handle: type,
    type,
    // A status this build does not know must not read as success.
    status: subagentStatusFromPi(rawStatus) ?? SubagentStatus.Failed,
    runKind: SubagentRunKind.Agent,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
  };
}

/** Every settled agent the Session's entries record, in the order pi wrote them. */
export function subagentRunsFromEntries(
  entries: readonly SessionEntry[],
): readonly SubagentAgent[] {
  const rows = new Map<string, SubagentAgent>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== SUBAGENT_RECORD_CUSTOM_TYPE) {
      continue;
    }
    const row = recordRow(entry.data, entry);
    if (row !== undefined && !rows.has(row.id)) {
      rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

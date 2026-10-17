/**
 * Steering one running subagent from the bridge.
 *
 * pi offers no RPC to reach a subagent, and its `@handle` mention path is inert in RPC mode. The
 * extension's own steering primitive is `manager.steer(id, message)`, which calls pi's public
 * `AgentSession.steer` and is the same call its `steer_subagent` tool makes, so the bridge reaches
 * that rather than a private channel.
 *
 * The guard and its wording mirror `steer_subagent`: only a `running` record is steerable, and a
 * queued or settled one is refused with the extension's own reason rather than a second opinion.
 * Nothing here spawns, stops or consumes an agent.
 */

import { BRIDGE_LOG_PREFIX } from "./client.js";
import type { SubagentManager } from "./subagents.js";

/** The answer the server gets for one steer request. */
export interface SteerOutcome {
  readonly ok: boolean;
  /** Present when `ok` is false. */
  readonly error?: string;
}

/** The status a steer is allowed to reach: pi-subagents' own `running`. */
const STEERABLE_STATUS = "running";

/** The extension's `steer_subagent` "not found" text. */
export function notFoundMessage(agentId: string): string {
  return `Agent not found: "${agentId}". It may have been cleaned up.`;
}

/** The extension's `steer_subagent` "not running" text. */
export function notRunningMessage(agentId: string, status: string | undefined): string {
  return `Agent "${agentId}" is not running (status: ${status ?? "unknown"}). Cannot steer a non-running agent.`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Steer one agent by its manager id. `manager` is passed in so the behaviour does not depend on
 * ambient discovery, and `undefined` (no pi-subagents) reads as an unknown agent.
 */
export async function steerAgent(
  manager: SubagentManager | undefined,
  agentId: string,
  message: string,
  log: (line: string) => void,
): Promise<SteerOutcome> {
  if (manager === undefined) {
    return { ok: false, error: notFoundMessage(agentId) };
  }
  let record: unknown;
  try {
    record = manager.getRecord(agentId);
  } catch (error) {
    log(
      `${BRIDGE_LOG_PREFIX} reading the record for ${agentId} to steer it failed: ${errorText(error)}`,
    );
    return { ok: false, error: notFoundMessage(agentId) };
  }
  if (!isRecord(record)) {
    return { ok: false, error: notFoundMessage(agentId) };
  }
  const status = typeof record["status"] === "string" ? record["status"] : undefined;
  if (status !== STEERABLE_STATUS) {
    return { ok: false, error: notRunningMessage(agentId, status) };
  }
  const session = record["session"];
  const steer = isRecord(session) ? session["steer"] : undefined;
  if (typeof steer !== "function") {
    // A running record without a live session is the transitional case `steer_subagent` reports as
    // not running: there is no conversation to put the message into yet.
    return { ok: false, error: notRunningMessage(agentId, status) };
  }
  try {
    await (steer as (text: string) => Promise<void>).call(session, message);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Failed to steer agent: ${errorText(error)}` };
  }
}

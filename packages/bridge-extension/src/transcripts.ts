/**
 * An agent's own conversation, forwarded over the bridge.
 *
 * pi-subagents runs each agent in its own pi session and puts that session on the manager record
 * once the run creates it, which is *after* the lifecycle event that names the agent. Nothing emits
 * an event when the session appears, so a missing session is watched for a bounded number of steps
 * rather than latched: latching would leave a running agent with no transcript for its whole life.
 *
 * Only the events the transcript view shows are forwarded, and pi's cumulative partial snapshot is
 * dropped from every streaming update: the server rebuilds the message from the deltas it receives,
 * so carrying the snapshot too would send the whole message again on each token.
 *
 * Read-only, like the rest of the bridge: subscribing adds a listener to the agent's session and
 * nothing here calls a method that changes it.
 */

import { SUBAGENT_TRANSCRIPT_EVENT_TYPES } from "@pi-my-ui/protocol";

import { BRIDGE_LOG_PREFIX } from "./client.js";
import type { SubagentLiveSession } from "./subagents.js";

/** How long to wait between reads of pi's record while waiting for an agent's session to appear. */
export const SESSION_LOOKUP_INTERVAL_MS = 100;

/**
 * How many reads before the transcript is given up on. A running agent's session exists within the
 * first few reads on a loaded machine; past this bound the agent is reported rather than watched
 * forever.
 */
export const SESSION_LOOKUP_ATTEMPTS = 25;

/** The forwarded event kinds, as a set for a lookup on pi's event type. */
const FORWARDED_TYPES: ReadonlySet<string> = new Set(SUBAGENT_TRANSCRIPT_EVENT_TYPES);

/** What a forwarded conversation event looks like on the wire: pi's event with its parts named. */
export type TranscriptEvent = Readonly<Record<string, unknown>>;

export interface TranscriptForwarderHost {
  /** The agent's live session, once pi-subagents has created it. */
  readonly sessionOf: (agentId: string) => SubagentLiveSession | undefined;
  readonly send: (agentId: string, event: TranscriptEvent) => void;
  readonly log: (line: string) => void;
  /** One unref'd timer, so a pending lookup never holds the pi process open. */
  readonly schedule?: (delayMs: number, callback: () => void) => () => void;
}

export interface TranscriptForwarder {
  /** Start forwarding one running agent's conversation; safe to call on every lifecycle event. */
  track(agentId: string): void;
  /** Forget every subscription and pending lookup, which a Session end requires. */
  stopAll(): void;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tool-call block at `index` of a partial message, which is where pi keeps a call's id. */
function partialBlockAt(
  partial: unknown,
  index: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(partial) || !Array.isArray(partial["content"]) || typeof index !== "number") {
    return undefined;
  }
  const block: unknown = partial["content"][index];
  return isRecord(block) ? block : undefined;
}

/**
 * One pi session event as the wire carries it, or `undefined` when the transcript does not show it.
 * A streaming tool-call start names its call from the partial message, because pi's own JSON event
 * form does: without that the card would open with no call to attach its result to.
 */
export function transcriptEventOf(value: unknown): TranscriptEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = value["type"];
  if (typeof type !== "string" || !FORWARDED_TYPES.has(type)) {
    return undefined;
  }
  if (type === "message_update") {
    const update = value["assistantMessageEvent"];
    if (!isRecord(update)) {
      return undefined;
    }
    if (update["type"] === "toolcall_delta") {
      // Partial arguments are JSON that does not parse yet, and the end event carries the parsed
      // call, so forwarding the fragments would only send every tool argument twice.
      return undefined;
    }
    if (update["type"] === "toolcall_start") {
      const index = update["contentIndex"];
      const block = partialBlockAt(update["partial"], index);
      return {
        type,
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: index,
          id: block?.["id"],
          toolName: block?.["name"],
        },
      };
    }
    return { type, assistantMessageEvent: update };
  }
  const message = value["message"];
  return isRecord(message) ? { type, message } : undefined;
}

function defaultSchedule(delayMs: number, callback: () => void): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}

export function createTranscriptForwarder(host: TranscriptForwarderHost): TranscriptForwarder {
  const schedule = host.schedule ?? defaultSchedule;
  /** Agents whose conversation is being forwarded, with the listener to release it. */
  const subscriptions = new Map<string, () => void>();
  /** One pending lookup per agent whose session is not there yet. */
  const lookups = new Map<string, () => void>();

  function forward(agentId: string, event: unknown): void {
    const payload = transcriptEventOf(event);
    if (payload !== undefined) {
      host.send(agentId, payload);
    }
  }

  /**
   * Subscribe to one agent's session and replay what it already said. The replay is the messages the
   * session holds, which is how the prompt that started the agent reaches the transcript; it is sent
   * before any live event because a subscribe callback cannot run inside this turn.
   */
  function attach(agentId: string): boolean {
    const session = host.sessionOf(agentId);
    if (session === undefined) {
      return false;
    }
    subscriptions.set(
      agentId,
      session.subscribe((event) => {
        forward(agentId, event);
      }),
    );
    for (const message of session.messages) {
      forward(agentId, { type: "message_end", message });
    }
    return true;
  }

  function watch(agentId: string): void {
    let attempts = 0;
    const step = (): void => {
      attempts += 1;
      if (attach(agentId)) {
        lookups.delete(agentId);
        return;
      }
      if (attempts >= SESSION_LOOKUP_ATTEMPTS) {
        lookups.delete(agentId);
        host.log(
          `${BRIDGE_LOG_PREFIX} agent ${agentId}: no live session after ` +
            `${String(SESSION_LOOKUP_ATTEMPTS * SESSION_LOOKUP_INTERVAL_MS)}ms; ` +
            `its transcript was never started`,
        );
        return;
      }
      lookups.set(agentId, schedule(SESSION_LOOKUP_INTERVAL_MS, step));
    };
    lookups.set(agentId, schedule(SESSION_LOOKUP_INTERVAL_MS, step));
  }

  return {
    track(agentId) {
      if (subscriptions.has(agentId) || lookups.has(agentId)) {
        return;
      }
      if (!attach(agentId)) {
        watch(agentId);
      }
    },
    stopAll() {
      for (const cancel of lookups.values()) {
        cancel();
      }
      lookups.clear();
      for (const unsubscribe of subscriptions.values()) {
        unsubscribe();
      }
      subscriptions.clear();
    },
  };
}

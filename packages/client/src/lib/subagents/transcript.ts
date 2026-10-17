/**
 * What a focused agent's empty transcript means: a live run has no turn yet, while a settled one
 * either finished empty or no longer has the conversation it wrote.
 */
export const AgentEmptyKind = {
  NoTurnsYet: "no-turns-yet",
  /** The run settled, and its own session file holds no message. */
  Finished: "finished",
  /** The run settled, and no conversation of it is on disk any more. */
  Gone: "gone",
  Unavailable: "unavailable",
} as const;

export type AgentEmptyKind = (typeof AgentEmptyKind)[keyof typeof AgentEmptyKind];

export interface AgentEmptyState {
  readonly kind: AgentEmptyKind;
  readonly message: string;
}

export const SUBAGENT_NO_TURNS_YET_MESSAGE = "This subagent has no messages yet.";

/** A settled run whose own file exists and records no message. */
export function subagentFinishedMessage(handle: string): string {
  return `@${handle} has finished without writing a message.`;
}

/** A settled run with no conversation on disk; it names no cause, which this client cannot establish. */
export function subagentGoneMessage(handle: string): string {
  return `@${handle} has finished; its conversation is no longer available.`;
}

/** A run whose file exists but was refused, with the server's own reason for the refusal. */
export function subagentUnavailableMessage(reason: string): string {
  return `This subagent's transcript is unavailable: ${reason}`;
}

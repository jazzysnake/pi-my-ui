/**
 * The Session index the drawer reads: the files pi wrote for this working directory, as disk facts.
 * pi's own Session reader does the parsing, so a listing can never drift from what pi would resume.
 *
 * A subagent run's child is such a file, but it belongs to a run behind the agent pill, not to the
 * Sessions the owner started, so the list drops it and keeps every fork and clone.
 *
 * Listing touches no Pi child. A Session's child starts only when a viewer subscribes to it, so the
 * list stays cheap and an unopened Session costs nothing.
 */

import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "@pi-my-ui/protocol";

import { isSubagentChild } from "./subagent-child-session.js";

/** Longest first-message excerpt a row carries; the row truncates further on a phone. */
const FIRST_MESSAGE_MAX_LENGTH = 160;

/** pi's placeholder for a file that holds no messages yet. */
const EMPTY_FIRST_MESSAGE = "(no messages)";

/**
 * Collapse a message's whitespace and cut it to one row's worth. Operates on code points so a
 * surrogate pair is never split.
 */
function summarizeFirstMessage(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const codePoints = [...collapsed];
  if (codePoints.length <= FIRST_MESSAGE_MAX_LENGTH) {
    return collapsed;
  }
  return `${codePoints.slice(0, FIRST_MESSAGE_MAX_LENGTH).join("")}…`;
}

function firstMessageOf(info: SessionInfo): string | null {
  if (info.messageCount === 0 || info.firstMessage === EMPTY_FIRST_MESSAGE) {
    return null;
  }
  const summary = summarizeFirstMessage(info.firstMessage);
  return summary === "" ? null : summary;
}

function toSummary(info: SessionInfo): SessionSummary {
  const name = info.name?.trim();
  return {
    id: info.id,
    name: name === undefined || name === "" ? null : name,
    firstMessage: firstMessageOf(info),
    lastActivityAt: info.modified.getTime(),
  };
}

/** Every Session for `cwd` the owner started, most recently active first, as the drawer renders it. */
export async function listSessions(
  cwd: string,
  sessionDir?: string,
): Promise<readonly SessionSummary[]> {
  const infos = await SessionManager.list(cwd, sessionDir);
  return infos.filter((info) => !isSubagentChild(info)).map(toSummary);
}

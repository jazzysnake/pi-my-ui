/**
 * The shape pi-subagents gives a run's child Session: a header naming the spawning Session, and a
 * `<agent type>#<first 8 of the run id>` name. The parent pointer alone identifies no child, because
 * pi sets it for the owner's own forks too, so both facts are read together: a misclassification
 * then lists a child rather than hides a Session.
 */

import type { SessionInfo } from "@earendil-works/pi-coding-agent";

/** Characters of the run id pi-subagents writes into a child's name. */
export const RUN_ID_PREFIX_LENGTH = 8;

/** The run id's prefix in the lower case a child's name uses, or `undefined` if too short. */
export function runIdPrefixOf(runId: string): string | undefined {
  return runId.length < RUN_ID_PREFIX_LENGTH
    ? undefined
    : runId.slice(0, RUN_ID_PREFIX_LENGTH).toLowerCase();
}

/** The prefix a child's name ends with, or `undefined` for any other name shape. */
export function childRunIdPrefixOf(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const marker = name.lastIndexOf("#");
  if (marker === -1) {
    return undefined;
  }
  const tail = name.slice(marker + 1);
  return tail.length === RUN_ID_PREFIX_LENGTH ? runIdPrefixOf(tail) : undefined;
}

export function isSubagentChild(info: SessionInfo): boolean {
  return info.parentSessionPath !== undefined && childRunIdPrefixOf(info.name) !== undefined;
}

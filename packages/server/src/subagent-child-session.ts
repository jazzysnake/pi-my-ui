/**
 * The shape pi-subagents gives a run's child Session: the spawning Session's file in the child's
 * header, and `<agent type>#<first characters of the run id>` as its name. The parent pointer alone
 * identifies no child, because pi also sets it for the owner's own forks and clones, so both facts
 * are read together: a misclassification then lists a child rather than hides a Session.
 */

import type { SessionInfo } from "@earendil-works/pi-coding-agent";

/** Characters of the run id that pi-subagents puts in a child session's name. */
export const RUN_ID_PREFIX_LENGTH = 8;

/** The run id prefix a child session's name ends with, or `undefined` for any other name shape. */
export function childRunIdPrefixOf(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const marker = name.lastIndexOf("#");
  const tail = name.slice(marker + 1);
  return marker !== -1 && tail.length === RUN_ID_PREFIX_LENGTH ? tail.toLowerCase() : undefined;
}

/** Whether pi's own listing reports this Session as a subagent run's child. */
export function isSubagentChild(info: SessionInfo): boolean {
  return info.parentSessionPath !== undefined && childRunIdPrefixOf(info.name) !== undefined;
}

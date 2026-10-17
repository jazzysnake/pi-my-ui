/**
 * One Session's message tree, and the Leaf moves that switch the transcript to another branch.
 *
 * A move goes through the bridge's command and is then confirmed from pi: pi swallows a refusal
 * inside an extension command, so a refused move and an unchanged Leaf look identical until the
 * Session is read again. Confirmation is also why a move needs the Projection's Leaf and a way to
 * rebuild it: pi is the authority, and the Projection follows what pi reports.
 */

import {
  ProtocolError,
  ProtocolErrorCode,
  leafNavigationInvocation,
  type SessionTree,
} from "@pi-my-ui/protocol";

import type { PiChild } from "./pi-child.js";
import { expectedLeafAfterNavigate, projectTree } from "./session-tree.js";

/** Where a confirmed move left the Leaf, and which entry the client asked to move to. */
export interface LeafMove {
  readonly entryId: string;
  readonly leafId: string | null;
}

export interface SessionLeafOptions {
  /** Make the Session servable: seed it the first time, and replace a child that is gone. */
  readonly serve: () => Promise<void>;
  readonly child: () => Promise<PiChild>;
  /** The Leaf the Projection currently holds. */
  readonly leafId: () => string | null;
  /** Rebuild the Projection from the Session file and hand every viewer a Snapshot. */
  readonly rebuild: () => Promise<void>;
  /** Record that the Session was used, which is where its idle window starts. */
  readonly touch: () => void;
}

export interface SessionLeaf {
  tree(): Promise<SessionTree>;
  move(entryId: string): Promise<LeafMove>;
}

export function createSessionLeaf(options: SessionLeafOptions): SessionLeaf {
  return {
    async tree() {
      await options.serve();
      const { tree, leafId } = await (await options.child()).tree();
      options.touch();
      return projectTree(tree, leafId);
    },
    async move(entryId) {
      await options.serve();
      const pi = await options.child();
      const before = await pi.tree();
      const expected = expectedLeafAfterNavigate(before.tree, entryId);
      if (expected === undefined) {
        throw new ProtocolError(
          ProtocolErrorCode.CommandFailed,
          `${entryId} is not in this Session's tree, so no leaf was moved`,
          entryId,
        );
      }
      // pi answers a move to the Leaf it is already on by doing nothing, so the honest result is
      // that Leaf rather than a refusal.
      if (before.leafId === entryId) {
        return { entryId, leafId: before.leafId };
      }
      if (!(await pi.runExtensionCommand(leafNavigationInvocation(entryId)))) {
        throw new ProtocolError(
          ProtocolErrorCode.CommandFailed,
          "pi did not run the bridge's leaf command, so no leaf was moved",
          entryId,
        );
      }
      const confirmed = (await pi.tree()).leafId;
      // Rebuilding only when the Leaf changed keeps a refused move from touching a Projection it
      // cannot affect, and a rebuilt one is numbered afresh, which no retained Cursor survives.
      if (confirmed !== options.leafId()) {
        await options.rebuild();
      }
      if (confirmed !== expected) {
        throw new ProtocolError(
          ProtocolErrorCode.CommandFailed,
          `pi left the active leaf at ${JSON.stringify(confirmed)}, so the move was refused or ` +
            "did not take effect",
          entryId,
        );
      }
      options.touch();
      return { entryId, leafId: confirmed };
    },
  };
}

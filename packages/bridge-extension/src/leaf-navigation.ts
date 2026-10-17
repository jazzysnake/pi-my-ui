/**
 * The bridge's one command that changes anything: move the active Leaf to an existing entry. pi offers
 * no RPC command for it, and a prompt naming a registered command is consumed by pi rather than sent
 * to the model. The server confirms the resulting Leaf, because pi swallows a refusal inside a
 * command handler. Nothing here creates, rewrites or deletes Session content.
 */

import { LEAF_NAVIGATION_COMMAND } from "@pi-my-ui/protocol";

import { BRIDGE_LOG_PREFIX } from "./client.js";

/** The one-line description pi lists for this command. */
export const LEAF_NAVIGATION_COMMAND_DESCRIPTION =
  "Move the session tree's active leaf to an existing entry";

/** The slice of pi's command context this handler reads; pi's own type satisfies it. */
export interface LeafNavigationContext {
  navigateTree(targetId: string): Promise<{ readonly cancelled: boolean }>;
}

/** The `registerCommand` slice of pi's `ExtensionAPI`. */
export interface LeafNavigationApi {
  registerCommand(
    name: string,
    options: {
      readonly description: string;
      readonly handler: (args: string, ctx: LeafNavigationContext) => Promise<void>;
    },
  ): void;
}

/** How the bridge reports a line; the same seam the socket client logs through. */
export type LeafNavigationLog = (line: string) => void;

/** Register the Leaf command; the argument is the target entry id. */
export function registerLeafNavigationCommand(pi: LeafNavigationApi, log: LeafNavigationLog): void {
  pi.registerCommand(LEAF_NAVIGATION_COMMAND, {
    description: LEAF_NAVIGATION_COMMAND_DESCRIPTION,
    handler: async (args, ctx) => {
      const targetId = args.trim();
      if (targetId === "") {
        log(
          `${BRIDGE_LOG_PREFIX} ${LEAF_NAVIGATION_COMMAND} was invoked with no entry id; ` +
            "no leaf was moved",
        );
        return;
      }
      try {
        const result = await ctx.navigateTree(targetId);
        if (result.cancelled) {
          log(
            `${BRIDGE_LOG_PREFIX} ${LEAF_NAVIGATION_COMMAND} ${targetId} was cancelled by pi; ` +
              "no leaf was moved",
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`${BRIDGE_LOG_PREFIX} ${LEAF_NAVIGATION_COMMAND} ${targetId} failed: ${reason}`);
      }
    },
  });
}

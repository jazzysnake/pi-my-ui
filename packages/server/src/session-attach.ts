/**
 * The reads a Session makes beside its Projection: pi's settings, the commands it offers and its
 * context figure. None of them is part of the transcript, and none is replayed on a subscribe, so a
 * browser that was away when one changed still sees pi's current value rather than a stale one.
 *
 * They live beside the host rather than in it because each is a read of the same child with the same
 * rule: a supplementary read that fails must not fail a subscription that already delivered a
 * Snapshot.
 */

import {
  ServerMessageType,
  type CommandsMessage,
  type ContextUsage,
  type ContextUsageMessage,
  type SessionRef,
  type SettingsMessage,
} from "@pi-my-ui/protocol";

import type { PiChild, PiSettings } from "./pi-child.js";
import type { SessionViewer } from "./session-host.js";

export function settingsMessage(session: SessionRef, settings: PiSettings): SettingsMessage {
  return { type: ServerMessageType.Settings, session, ...settings };
}

export function commandsMessage(
  session: SessionRef,
  commands: CommandsMessage["commands"],
): CommandsMessage {
  return { type: ServerMessageType.Commands, session, commands };
}

export function contextUsageMessage(
  session: SessionRef,
  contextUsage: ContextUsage | null,
): ContextUsageMessage {
  return { type: ServerMessageType.ContextUsage, session, contextUsage };
}

/** Hand one viewer everything pi can say about a Session besides its transcript. */
export async function sendAttachSupplements(
  viewer: SessionViewer,
  session: SessionRef,
  child: () => Promise<PiChild>,
): Promise<void> {
  try {
    viewer.onMessage(settingsMessage(session, await (await child()).settings()));
  } catch {
    // Nothing else here needs the settings, so a child that cannot answer one still serves the rest.
  }
  try {
    viewer.onMessage(commandsMessage(session, await (await child()).commands()));
  } catch {
    // The palette falls back to the built-ins rather than failing the subscription.
  }
  try {
    viewer.onMessage(contextUsageMessage(session, (await (await child()).stats()).contextUsage));
  } catch {
    // The readout says a figure is unavailable; the transcript is unaffected.
  }
}

/**
 * Hand every viewer of a Session those same surfaces, in the same order. A reload replaced the
 * process, so settings, the palette and the context figure are all stale in every viewer at once.
 */
export async function broadcastAttachSupplements(
  viewers: readonly SessionViewer[],
  session: SessionRef,
  child: () => Promise<PiChild>,
): Promise<void> {
  // One reader whose output is every viewer, so each surface is read once from the new child instead
  // of once per viewer, and the three keep the order an attach sends them in.
  const everyViewer: SessionViewer = {
    onMessage(message) {
      for (const viewer of viewers) {
        viewer.onMessage(message);
      }
    },
  };
  await sendAttachSupplements(everyViewer, session, child);
}

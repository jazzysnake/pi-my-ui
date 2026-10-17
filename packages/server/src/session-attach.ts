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
  type SettingsMessage,
} from "@pi-my-ui/protocol";

import type { PiChild, PiSettings } from "./pi-child.js";
import type { SessionViewer } from "./session-host.js";

export function settingsMessage(sessionId: string, settings: PiSettings): SettingsMessage {
  return { type: ServerMessageType.Settings, sessionId, ...settings };
}

export function commandsMessage(
  sessionId: string,
  commands: CommandsMessage["commands"],
): CommandsMessage {
  return { type: ServerMessageType.Commands, sessionId, commands };
}

export function contextUsageMessage(
  sessionId: string,
  contextUsage: ContextUsage | null,
): ContextUsageMessage {
  return { type: ServerMessageType.ContextUsage, sessionId, contextUsage };
}

/** Hand one viewer everything pi can say about a Session besides its transcript. */
export async function sendAttachSupplements(
  viewer: SessionViewer,
  sessionId: string,
  child: () => Promise<PiChild>,
): Promise<void> {
  try {
    viewer.onMessage(settingsMessage(sessionId, await (await child()).settings()));
  } catch {
    // Nothing else here needs the settings, so a child that cannot answer one still serves the rest.
  }
  try {
    viewer.onMessage(commandsMessage(sessionId, await (await child()).commands()));
  } catch {
    // The palette falls back to the built-ins rather than failing the subscription.
  }
  try {
    viewer.onMessage(contextUsageMessage(sessionId, (await (await child()).stats()).contextUsage));
  } catch {
    // The readout says a figure is unavailable; the transcript is unaffected.
  }
}

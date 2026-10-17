/**
 * The bridge records a Session's Projection is built from beyond pi's RPC: its agents' lifecycle and
 * their conversations. Wired in one place so a Session cannot pick up one stream and miss the other.
 *
 * The socket carries every child the server runs, so each record is filtered to the Session that
 * subscribed: a record for another Session has no Projection here to advance.
 */

import type { SubagentAgent } from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** Where one Session's bridge records go. */
export interface BridgeEventTarget {
  applyAgent(agent: SubagentAgent): void;
  applyTranscript(agentId: string, event: JsonAgentSessionEvent): void;
}

/** The bridge side of the wiring: the two subscriptions a Session needs. */
export interface BridgeSubscriptions {
  onAgent(listener: (sessionId: string, agent: SubagentAgent) => void): () => void;
  onTranscript(
    listener: (sessionId: string, agentId: string, event: JsonAgentSessionEvent) => void,
  ): () => void;
}

/** Subscribe one Session to its child's records; returns a detach. */
export function attachBridgeEvents(
  bridge: BridgeSubscriptions,
  sessionId: string,
  target: BridgeEventTarget,
): () => void {
  const detachAgents = bridge.onAgent((recorded, agent) => {
    if (recorded === sessionId) {
      target.applyAgent(agent);
    }
  });
  const detachTranscripts = bridge.onTranscript((recorded, agentId, event) => {
    if (recorded === sessionId) {
      target.applyTranscript(agentId, event);
    }
  });
  return () => {
    detachAgents();
    detachTranscripts();
  };
}

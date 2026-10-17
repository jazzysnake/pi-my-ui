/** What a Session needs from the bridge to be served: the handshake wait, its record streams, and a steer. */

import type { BridgeSteerOutcome } from "@pi-my-ui/protocol";

import type { BridgeSubscriptions } from "./events.js";

export interface BridgeGate extends BridgeSubscriptions {
  waitForSession(sessionId: string): Promise<void>;
  /** Ask a Session's child to steer one running agent; the answer is the child's, never a guess. */
  steer(sessionId: string, agentId: string, message: string): Promise<BridgeSteerOutcome>;
}

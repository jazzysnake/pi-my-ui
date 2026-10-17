/**
 * Steering one running agent of a Session. pi's RPC cannot reach a subagent, so this is the bridge's
 * job; a refusal is thrown as a typed failure, so the browser gets the reason against its message.
 */

import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

import type { BridgeGate } from "./bridge/gate.js";

export interface SessionSteering {
  /** Hand one message to a running agent; a refusal throws with the bridge's own reason. */
  steerSubagent(agentId: string, message: string): Promise<void>;
}

/** Which Session to steer and which bridge reaches it. */
export interface SessionSteeringSource {
  readonly sessionId: string;
  readonly bridge: BridgeGate;
}

/**
 * `serve` makes the Session servable first, so a steer never reaches an evicted Session's absent
 * child; `touch` restarts the idle window it is in use again.
 */
export function createSessionSteering(
  source: SessionSteeringSource,
  serve: () => Promise<void>,
  touch: () => void,
): SessionSteering {
  return {
    async steerSubagent(agentId, message) {
      await serve();
      const outcome = await source.bridge.steer(source.sessionId, agentId, message);
      if (!outcome.ok) {
        throw new ProtocolError(
          ProtocolErrorCode.CommandFailed,
          outcome.error ?? "the subagent could not be steered",
        );
      }
      touch();
    },
  };
}

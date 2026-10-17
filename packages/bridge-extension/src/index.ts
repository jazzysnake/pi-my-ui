/**
 * The bridge extension, loaded into every Pi child. It connects to the server's user-only Unix
 * socket on `session_start`; the server serves the Session only once that handshake is done, so a
 * child without a bridge is a loud server failure, not a Session that quietly lacks a capability.
 * Its one mutation is moving the Session's Leaf to an entry that already exists; it never spawns,
 * stops or consumes a subagent, and it never writes Session content.
 */

import { BRIDGE_SOCKET_ENV_VAR } from "@pi-my-ui/protocol";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BridgeRecordType, SubagentStatus, type SubagentAgent } from "@pi-my-ui/protocol";

import { BRIDGE_LOG_PREFIX, BridgeClient, type BridgeLog } from "./client.js";
import { registerLeafNavigationCommand } from "./leaf-navigation.js";
import {
  SUBAGENTS_LIFECYCLE_CHANNELS,
  lifecycleAgent,
  liveSessionOf,
  subagentManager,
} from "./subagents.js";
import { createTranscriptForwarder } from "./transcripts.js";

export {
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_LOG_PREFIX,
  BRIDGE_RECONNECT_DELAYS_MS,
} from "./client.js";
export { BridgeClient, type BridgeClientOptions, type BridgeLog } from "./client.js";
export {
  LEAF_NAVIGATION_COMMAND_DESCRIPTION,
  registerLeafNavigationCommand,
  type LeafNavigationApi,
  type LeafNavigationContext,
  type LeafNavigationLog,
} from "./leaf-navigation.js";
export {
  SUBAGENTS_CREATED_CHANNEL,
  SUBAGENTS_LIFECYCLE_CHANNELS,
  SUBAGENT_MANAGER_SYMBOL_KEY,
  lifecycleAgent,
  liveSessionOf,
  subagentManager,
} from "./subagents.js";
export type {
  SubagentLifecycleChannel,
  SubagentLiveSession,
  SubagentManager,
} from "./subagents.js";
export {
  SESSION_LOOKUP_ATTEMPTS,
  SESSION_LOOKUP_INTERVAL_MS,
  createTranscriptForwarder,
  transcriptEventOf,
} from "./transcripts.js";
export type {
  TranscriptEvent,
  TranscriptForwarder,
  TranscriptForwarderHost,
} from "./transcripts.js";

function defaultLog(line: string): void {
  // RPC mode reserves stdout for protocol records, so every diagnostic goes to stderr.
  console.error(line);
}

/**
 * Wire the bridge onto a pi session. Exported so the extension's wiring can be named in one place;
 * pi calls the default export below.
 */
export function registerBridge(pi: ExtensionAPI, log: BridgeLog = defaultLog): void {
  let client: BridgeClient | undefined;
  let agents = new Map<string, SubagentAgent>();

  /**
   * An agent's conversation is forwarded while the agent runs; the sink reaches the current socket,
   * so a record produced before the handshake completes waits in the client's queue rather than
   * being dropped.
   */
  const transcripts = createTranscriptForwarder({
    sessionOf: (agentId) => liveSessionOf(subagentManager(), agentId, log),
    send: (agentId, event) => {
      client?.send({ type: BridgeRecordType.Transcript, agentId, event });
    },
    log,
  });

  // Registered before anything else: the server reaches a leaf move by invoking this command, and a
  // Session served without it could not switch branches at all.
  registerLeafNavigationCommand(pi, log);

  // Subscribed at factory time, so a pi-subagents activation that runs its own `session_start`
  // handler first is already discoverable here.
  for (const channel of SUBAGENTS_LIFECYCLE_CHANNELS) {
    pi.events.on(channel, (data) => {
      const active = client;
      if (active === undefined) {
        return;
      }
      const agent = lifecycleAgent(channel, data, (id) => agents.get(id), subagentManager(), log);
      if (agent === undefined) {
        return;
      }
      agents.set(agent.id, agent);
      // `type` is the record's discriminant on this wire, so the agent's own type travels as
      // `agentType` and cannot collide with it.
      active.send({
        type: BridgeRecordType.Agent,
        id: agent.id,
        handle: agent.handle,
        agentType: agent.type,
        status: agent.status,
        ...(agent.startedAt === undefined ? {} : { startedAt: agent.startedAt }),
        ...(agent.finishedAt === undefined ? {} : { finishedAt: agent.finishedAt }),
      });
      // A queued agent has no session yet, so only a running one has a conversation to forward.
      if (agent.status === SubagentStatus.Running) {
        transcripts.track(agent.id);
      }
    });
  }

  pi.on("session_start", (_event, ctx) => {
    const socketPath = process.env[BRIDGE_SOCKET_ENV_VAR];
    if (socketPath === undefined || socketPath === "") {
      log(`${BRIDGE_LOG_PREFIX} ${BRIDGE_SOCKET_ENV_VAR} is not set; this session has no bridge`);
      return;
    }
    client?.stop();
    // A previous session in this process reported agents that this one has not; keeping them would
    // attribute another Session's runs to this one.
    agents = new Map();
    transcripts.stopAll();
    client = new BridgeClient({
      socketPath,
      sessionId: ctx.sessionManager.getSessionId(),
      pid: process.pid,
      log,
    });
    client.start();
  });

  pi.on("session_shutdown", () => {
    client?.stop();
    client = undefined;
    agents = new Map();
    transcripts.stopAll();
  });
}

/** pi extension factory; the compiled file is loaded with `--extension`. */
export default function registerBridgeExtension(pi: ExtensionAPI): void {
  registerBridge(pi);
}

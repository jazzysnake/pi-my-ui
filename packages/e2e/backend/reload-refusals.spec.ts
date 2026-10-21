import { expect, test } from "vitest";

import {
  ContentBlockType,
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  type BashExecutionResult,
  type CompactionBoundaryEntry,
  type ErrorMessage,
  type RunStateKind,
  type SubagentStatus,
} from "@pi-my-ui/protocol";
import type { Script } from "@pi-my-ui/scripted-provider";

import type { Gate } from "../src/gate";
import { attach, readUntil, startHarness } from "../src/reload-harness";
import { connectWsSession, type WsSessionClient } from "../src/ws-session-client";
import { readUntilText } from "../src/ws-transcript";

/** Read Deltas until the Projection reports `kind`, which is the state a refusal is about. */
async function untilRunState(client: WsSessionClient, kind: RunStateKind): Promise<void> {
  for (let read = 0; read < 200; read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    const reached = message.deltas.some(
      (delta) => delta.kind === ProjectionDeltaKind.RunState && delta.runState.kind === kind,
    );
    if (reached) {
      return;
    }
  }
  throw new Error(`the run never reported ${kind}`);
}

/** Read until a projected direct shell card satisfies `ready`, returning the result it carries. */
async function untilShellCard(
  client: WsSessionClient,
  ready: (result: BashExecutionResult | undefined) => boolean,
): Promise<BashExecutionResult | undefined> {
  for (let read = 0; read < 200; read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    for (const delta of message.deltas) {
      if (delta.kind !== ProjectionDeltaKind.EntryUpsert) {
        continue;
      }
      const entry = delta.entry;
      if (entry.kind !== EntryKind.Message || entry.role !== MessageRole.Bash) {
        continue;
      }
      for (const block of entry.blocks) {
        if (block.type === ContentBlockType.BashExecution && ready(block.result)) {
          return block.result;
        }
      }
    }
  }
  throw new Error("the shell card never reached the state the test waited for");
}

/** Read until compaction replaced the earlier history, and report the boundary it wrote. */
async function untilBoundary(client: WsSessionClient): Promise<CompactionBoundaryEntry> {
  for (let read = 0; read < 200; read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    for (const delta of message.deltas) {
      if (
        delta.kind === ProjectionDeltaKind.EntryUpsert &&
        delta.entry.kind === EntryKind.CompactionBoundary
      ) {
        return delta.entry;
      }
    }
  }
  throw new Error("the compaction never wrote a boundary");
}

/** The refusal one reload received, which is the whole answer a refused request gets. */
async function refusalOf(client: WsSessionClient): Promise<ErrorMessage> {
  const frames = await readUntil(client, "error");
  const refusal = frames.at(-1);
  if (refusal?.type !== "error") {
    throw new Error("the reload was answered with no error");
  }
  return refusal;
}

const STREAMING_PROMPT = "hold the turn open";
const STREAMING_REPLY = "the held turn finished";

function streamingScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: STREAMING_PROMPT },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_slow_command",
            name: "bash",
            arguments: { ...gate("streaming-turn").command("echo the held command ran") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: STREAMING_REPLY }], stopReason: "stop" },
    },
  ];
}

test("a reload is refused while a turn streams, and the turn still finishes", async () => {
  const harness = await startHarness({ script: streamingScript });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    await harness.gate("streaming-turn").releaseAfter(async () => {
      client.send({ type: "prompt", session, text: STREAMING_PROMPT });
      await untilRunState(client, "streaming");
      client.send({ type: "reload", session });
      expect(await refusalOf(client)).toMatchObject({
        type: "error",
        session,
        error: {
          code: "commandFailed",
          message: "Wait for the current response to finish before reloading.",
        },
      });
    });

    // Nothing was replaced: the turn's own reply still arrives on the stream it was streaming to.
    const deltas = await readUntilText(client, STREAMING_REPLY);
    expect(deltas.length).toBeGreaterThan(0);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

const RETRY_PROMPT = "try the turn again";
const RETRY_REPLY = "the retried turn finished";

/**
 * A turn that fails retryably and then succeeds. pi backs off between attempts, and a turn waiting to
 * retry is a turn a reload would cut; the backoff is pi's own setting widened so the state is
 * observably live rather than a window the test races.
 */
const RETRY_SCRIPT: Script = [
  {
    expect: { role: "user", text: RETRY_PROMPT },
    reply: { content: [], stopReason: "error", errorMessage: "529 overloaded" },
  },
  {
    expect: { role: "user", text: RETRY_PROMPT },
    reply: { content: [{ type: "text", text: RETRY_REPLY }], stopReason: "stop" },
  },
];

const RETRY_SETTINGS = { retry: { baseDelayMs: 4000 } };

test("a reload is refused while a turn retries, and the retry still finishes", async () => {
  const harness = await startHarness({ script: RETRY_SCRIPT, settings: RETRY_SETTINGS });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    client.send({ type: "prompt", session, text: RETRY_PROMPT });
    await untilRunState(client, "retrying");
    client.send({ type: "reload", session });
    expect(await refusalOf(client)).toMatchObject({
      type: "error",
      session,
      error: {
        code: "commandFailed",
        message: "Wait for the current response to finish before reloading.",
      },
    });

    const deltas = await readUntilText(client, RETRY_REPLY);
    expect(deltas.length).toBeGreaterThan(0);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

/**
 * pi's own compaction settings, written into the hermetic home: the committed seeds are small, so a
 * default keep-recent budget would keep every message and pi would refuse to compact at all. The
 * retry delay is pi's, widened so the test observes a compaction that is genuinely still running.
 */
const COMPACTION_SETTINGS = {
  compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 100 },
  retry: { baseDelayMs: 4000 },
};
const SUMMARY = "The session had read the API surface and agreed on the next step.";

/** A summarization that fails once and is retried, so the compaction stays live for the refusal. */
const COMPACTION_SCRIPT: Script = [
  {
    expect: { role: "compaction" },
    reply: { content: [], stopReason: "error", errorMessage: "529 overloaded" },
  },
  {
    expect: { role: "compaction" },
    reply: { content: [{ type: "text", text: SUMMARY }], stopReason: "stop" },
  },
];

test("a reload is refused while a compaction runs, and the compaction still finishes", async () => {
  const harness = await startHarness({
    script: COMPACTION_SCRIPT,
    settings: COMPACTION_SETTINGS,
  });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    client.send({ type: "compact", session });
    await untilRunState(client, "compacting");
    client.send({ type: "reload", session });
    expect(await refusalOf(client)).toMatchObject({
      type: "error",
      session,
      error: {
        code: "commandFailed",
        message: "Wait for compaction to finish before reloading.",
      },
    });

    // The child was never stopped, so pi's retry produced the summary and the boundary landed.
    expect((await untilBoundary(client)).summary).toContain(SUMMARY);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("a reload is refused while a direct shell command has no result, and the command finishes", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    const command = harness.gate("shell-command").command("echo the build finished");
    await harness.gate("shell-command").releaseAfter(async () => {
      client.send({
        type: "bash",
        session,
        command: command.command,
        excludeFromContext: false,
      });
      await untilShellCard(client, (result) => result === undefined);
      client.send({ type: "reload", session });
      const refusal = await refusalOf(client);
      expect(refusal).toMatchObject({
        type: "error",
        session,
        error: { code: "commandFailed" },
      });
      // The refusal names the command whose output a reload would destroy unread.
      expect(refusal.error.message).toContain(command.command);
    });

    // The command kept its process: its exit status reaches the card the viewer is reading.
    expect(await untilShellCard(client, (result) => result !== undefined)).toMatchObject({
      exitCode: 0,
    });
  } finally {
    await client.close();
    await harness.dispose();
  }
});

/** Read until an agent reports `status`; with `idle`, the Session's own run must be idle as well. */
async function untilAgent(
  client: WsSessionClient,
  status: SubagentStatus,
  idle = false,
): Promise<void> {
  let reported = false;
  let settled = !idle;
  for (let read = 0; read < 300 && !(reported && settled); read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    for (const delta of message.deltas) {
      if (delta.kind === ProjectionDeltaKind.SubagentUpsert && delta.agent.status === status) {
        reported = true;
      }
      if (delta.kind === ProjectionDeltaKind.RunState && delta.runState.kind === "idle") {
        settled = true;
      }
    }
  }
  if (!reported || !settled) {
    throw new Error(`the Session never showed a ${status} agent with its own run idle`);
  }
}

const SPAWN_PROMPT = "spawn a helper in the background";
const PARENT_REPLY = "the background helper is running";
const AGENT_REPLY = "the helper did its work";

/**
 * A background spawn: the parent settles while the subagent is blocked on the run gate, so the only
 * work left in the Session is an agent that a reload would abort without being asked.
 */
function backgroundAgentScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: SPAWN_PROMPT },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_background_agent",
            name: "Agent",
            arguments: {
              subagent_type: "general-purpose",
              prompt: "work slowly",
              description: "Work slowly",
              run_in_background: true,
            },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "Agent" },
      reply: { content: [{ type: "text", text: PARENT_REPLY }], stopReason: "stop" },
    },
    {
      expect: { role: "user", text: "work slowly" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_agent_command",
            name: "bash",
            arguments: { ...gate("subagent-run").command("echo the helper did its work") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: AGENT_REPLY }], stopReason: "stop" },
    },
  ];
}

test("a reload is refused while a subagent runs, and the subagent still finishes", async () => {
  const harness = await startHarness({ script: backgroundAgentScript });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    await harness.gate("subagent-run").releaseAfter(async () => {
      client.send({ type: "prompt", session, text: SPAWN_PROMPT });
      await untilAgent(client, "running", true);
      client.send({ type: "reload", session });
      expect(await refusalOf(client)).toMatchObject({
        type: "error",
        session,
        // A count, so one agent is told apart from several.
        error: { code: "commandFailed", message: "subagents are still queued or running: 1" },
      });
    });

    // The agent kept its process and finished, which a replaced child could not have done.
    await untilAgent(client, "completed");
  } finally {
    await client.close();
    await harness.dispose();
  }
});

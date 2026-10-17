/**
 * The server's live Projection for one Session: pi's event stream reduced to the same Deltas the
 * browser receives. Deltas are the only thing this module produces; the Projection is always derived
 * by running them through the shared reducer, so the server and a client replaying the same Deltas
 * cannot disagree.
 *
 * A live message carries no durable entry id (pi assigns one when it persists the message), so a
 * message being streamed is addressed by a provisional id. The durable id replaces it on a resync;
 * within one connection the provisional id is stable, which is what keeps a streamed row from being
 * re-created on every delta.
 */

import {
  ContentBlockType,
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  RunStateKind,
  ToolCallStatus,
  reduceDeltaBatch,
  sameSubagentAgent,
  type ContentBlock,
  type PiChildExit,
  type ProjectedEntry,
  type ProjectedMessageEntry,
  type ProjectionDelta,
  type RunState,
  type SessionProjection,
  type SubagentAgent,
} from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";

import { createLiveBash, type LiveBash } from "./live-bash.js";
import { createLiveCompaction } from "./live-compaction.js";
import { blocksFromMessage, projectionBatch, roleOf, toolResultOutput } from "./projection.js";
import { blockEditOf } from "./streaming-blocks.js";
import { createSubagentTranscripts } from "./subagent-transcripts.js";
import { workflowRunsFromEntries } from "./workflow-runs.js";
import { createLiveWorkflow } from "./live-workflow.js";

type AgentMessage = Extract<JsonAgentSessionEvent, { readonly type: "message_start" }>["message"];
type MessageStartEvent = Extract<JsonAgentSessionEvent, { readonly type: "message_start" }>;
type MessageEndEvent = Extract<JsonAgentSessionEvent, { readonly type: "message_end" }>;
type MessageUpdateEvent = Extract<JsonAgentSessionEvent, { readonly type: "message_update" }>;
type AgentEndEvent = Extract<JsonAgentSessionEvent, { readonly type: "agent_end" }>;

const IDLE_RUN_STATE: RunState = { kind: RunStateKind.Idle };

export interface SessionProjectionMachine {
  readonly projection: SessionProjection;
  /** The live `!`/`!!` card; its deltas are applied through the same reducer as any other. */
  readonly bash: LiveBash;
  /** Seed from pi's durable entries; returns the Cursor the seeded Projection sits at. */
  seed(entries: readonly SessionEntry[], leafId: string | null): number;
  applyEvent(event: JsonAgentSessionEvent): readonly ProjectionDelta[];
  /** Apply one subagent record from the bridge; a repeat of the same state is not re-published. */
  applySubagent(agent: SubagentAgent): readonly ProjectionDelta[];
  /** Apply one event from an agent's own session; that agent's conversation is part of this one. */
  applySubagentEvent(agentId: string, event: JsonAgentSessionEvent): readonly ProjectionDelta[];
  markAborted(): readonly ProjectionDelta[];
  /** The Session's Pi child is gone; nothing it was doing is still going on. */
  markCrashed(exit: PiChildExit): readonly ProjectionDelta[];
}

export function createSessionProjectionMachine(
  sessionId: string,
  cwd: string,
): SessionProjectionMachine {
  let projection: SessionProjection = {
    sessionId,
    cwd,
    leafId: null,
    entries: [],
    runState: IDLE_RUN_STATE,
    subagents: [],
    subagentTranscripts: [],
  };
  let streamingEntryId: string | null = null;
  let pendingId = 0;
  let abortRequested = false;

  const agentTranscripts = createSubagentTranscripts((agentId) =>
    createSessionProjectionMachine(agentId, cwd),
  );

  const compaction = createLiveCompaction({
    nextId,
    leafId: () => projection.leafId,
    runState: () => projection.runState,
    emit,
    upsert,
    setLeaf,
    setRunState,
  });

  const workflow = createLiveWorkflow({
    toolCall: toolCallOf,
    agents: () => projection.subagents,
    applySubagent,
  });

  const bash = createLiveBash({
    nextId,
    entry: entryById,
    leafId: () => projection.leafId,
    emit,
    upsert,
    setLeaf,
    remove: (entryId) => ({ kind: ProjectionDeltaKind.EntryRemoved, entryId }),
  });

  function nextId(): string {
    pendingId += 1;
    return `pending:${String(pendingId)}`;
  }

  function emit(deltas: readonly ProjectionDelta[]): readonly ProjectionDelta[] {
    if (deltas.length === 0) {
      return [];
    }
    projection = reduceDeltaBatch(projection, { fromCursor: 0, cursor: 0, deltas });
    return deltas;
  }

  function upsert(entry: ProjectedEntry): ProjectionDelta {
    return { kind: ProjectionDeltaKind.EntryUpsert, entry };
  }

  function setLeaf(leafId: string | null): ProjectionDelta {
    return { kind: ProjectionDeltaKind.LeafChanged, leafId };
  }

  function setRunState(runState: RunState): ProjectionDelta {
    return { kind: ProjectionDeltaKind.RunState, runState };
  }

  /**
   * The delta one agent report needs, or none when it repeats the state already projected. Shared by
   * the bridge's reports and the workflow rows this machine derives itself, so both are de-duplicated
   * the same way.
   */
  function applySubagent(agent: SubagentAgent): readonly ProjectionDelta[] {
    return emit(subagentDeltas(agent));
  }

  function subagentDeltas(agent: SubagentAgent): readonly ProjectionDelta[] {
    const existing = projection.subagents.find((candidate) => candidate.id === agent.id);
    if (existing !== undefined && sameSubagentAgent(existing, agent)) {
      return [];
    }
    return [{ kind: ProjectionDeltaKind.SubagentUpsert, agent }];
  }

  /** Every message row this machine builds, in one place. */
  function messageEntry(
    role: MessageRole,
    id: string,
    parentId: string | null,
    timestamp: number,
    blocks: readonly ContentBlock[],
  ): ProjectedEntry {
    return { kind: EntryKind.Message, id, parentId, role, timestamp, blocks };
  }

  function entryById(id: string): ProjectedEntry | undefined {
    return projection.entries.find((entry) => entry.id === id);
  }

  function appendMessage(message: AgentMessage): readonly ProjectionDelta[] {
    const role = roleOf(message);
    if (role === undefined) {
      return [];
    }
    const id = nextId();
    return emit([
      upsert(messageEntry(role, id, projection.leafId, Date.now(), blocksFromMessage(message))),
      setLeaf(id),
    ]);
  }

  function ensureStreamingAssistant(): {
    readonly id: string;
    readonly blocks: readonly ContentBlock[];
    readonly deltas: readonly ProjectionDelta[];
  } {
    const id = streamingEntryId;
    if (id !== null) {
      const entry = entryById(id);
      if (
        entry !== undefined &&
        entry.kind === EntryKind.Message &&
        entry.role === MessageRole.Assistant
      ) {
        return { id, blocks: entry.blocks, deltas: [] };
      }
    }
    const newId = nextId();
    streamingEntryId = newId;
    return {
      id: newId,
      blocks: [],
      deltas: [
        upsert(messageEntry(MessageRole.Assistant, newId, projection.leafId, Date.now(), [])),
        setLeaf(newId),
      ],
    };
  }

  function withStreamingBlocks(
    update: (blocks: readonly ContentBlock[]) => readonly ContentBlock[],
  ): readonly ProjectionDelta[] {
    const streaming = ensureStreamingAssistant();
    const existing = entryById(streaming.id);
    return emit([
      ...streaming.deltas,
      upsert(
        messageEntry(
          MessageRole.Assistant,
          streaming.id,
          existing?.parentId ?? projection.leafId,
          existing?.timestamp ?? Date.now(),
          update(streaming.blocks),
        ),
      ),
    ]);
  }

  function onMessageStart(event: MessageStartEvent): readonly ProjectionDelta[] {
    const role = roleOf(event.message);
    if (role !== MessageRole.Assistant) {
      return [];
    }
    const id = nextId();
    streamingEntryId = id;
    return emit([
      upsert(messageEntry(MessageRole.Assistant, id, projection.leafId, Date.now(), [])),
      setLeaf(id),
    ]);
  }

  function onToolResult(
    message: Extract<AgentMessage, { readonly role: "toolResult" }>,
  ): readonly ProjectionDelta[] {
    const call = toolCallOf(message.toolCallId);
    if (call === undefined) {
      return [];
    }
    const { entry, index } = call;
    const block = entry.blocks[index];
    if (block === undefined || block.type !== ContentBlockType.ToolCall) {
      return [];
    }
    const blocks = [...entry.blocks];
    const output = toolResultOutput(message);
    blocks[index] = {
      ...block,
      status: message.isError ? ToolCallStatus.Error : ToolCallStatus.Success,
      ...(output === "" ? {} : { output }),
    };
    return emit([upsert({ ...entry, blocks })]);
  }

  /** The assistant row and block a tool result answers, wherever the call sits on the path. */
  function toolCallOf(
    toolCallId: string,
  ): { readonly entry: ProjectedMessageEntry; readonly index: number } | undefined {
    for (const entry of projection.entries) {
      if (entry.kind !== EntryKind.Message || entry.role !== MessageRole.Assistant) {
        continue;
      }
      const index = entry.blocks.findIndex(
        (block) => block.type === ContentBlockType.ToolCall && block.id === toolCallId,
      );
      if (index !== -1) {
        return { entry, index };
      }
    }
    return undefined;
  }

  function onMessageEnd(event: MessageEndEvent): readonly ProjectionDelta[] {
    const message = event.message;
    if (message.role === "toolResult") {
      const launched = workflow.launch(message);
      const folded = onToolResult(message);
      // A result whose call is not on the path (an abandoned branch) keeps its own row.
      const transcript = folded.length > 0 ? folded : appendMessage(message);
      return [...launched, ...transcript];
    }
    if (roleOf(message) !== MessageRole.Assistant) {
      return appendMessage(message);
    }

    const blocks = blocksFromMessage(message);
    const id = streamingEntryId ?? nextId();
    const existing = entryById(id);
    streamingEntryId = null;
    // An empty assistant message (a cancelled or failed attempt pi recorded with no content) adds
    // no row; the placeholder that was created for it is removed so the transcript stays clean.
    if (blocks.length === 0) {
      if (existing === undefined) {
        return [];
      }
      return emit([
        { kind: ProjectionDeltaKind.EntryRemoved, entryId: id },
        setLeaf(existing.parentId),
      ]);
    }
    return emit([
      upsert(
        messageEntry(
          MessageRole.Assistant,
          id,
          existing?.parentId ?? projection.leafId,
          existing?.timestamp ?? Date.now(),
          blocks,
        ),
      ),
    ]);
  }

  function onMessageUpdate(event: MessageUpdateEvent): readonly ProjectionDelta[] {
    const edit = blockEditOf(event.assistantMessageEvent);
    return edit === null ? [] : withStreamingBlocks(edit);
  }

  function onAgentEnd(event: AgentEndEvent): readonly ProjectionDelta[] {
    if (event.willRetry) {
      return [];
    }
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message === undefined || message.role !== "assistant") {
        continue;
      }
      if (abortRequested) {
        return emit([setRunState({ kind: RunStateKind.Aborted })]);
      }
      if (message.stopReason === "error") {
        return emit([
          setRunState({
            kind: RunStateKind.Errored,
            message: message.errorMessage ?? "the run failed",
          }),
        ]);
      }
      if (message.stopReason === "aborted") {
        return emit([setRunState({ kind: RunStateKind.Aborted })]);
      }
      return [];
    }
    return [];
  }

  return {
    get projection() {
      return projection;
    },
    bash,
    seed(entries, leafId) {
      bash.reset();
      const batch = projectionBatch({ entries, leafId, fromCursor: 0 });
      // The bridge can report an agent before pi's entries finish reading, and those records outlive
      // the reseed, since the seed describes the transcript and not who is working on it. Workflow
      // runs are the opposite: nothing live reports them, so the reseed re-derives them from the same
      // entries a launch and a settle leave behind.
      const live = projection.subagents.filter((agent) => agent.runKind !== "workflow");
      projection = reduceDeltaBatch(
        {
          sessionId,
          cwd,
          leafId: null,
          entries: [],
          runState: IDLE_RUN_STATE,
          subagents: [...live, ...workflowRunsFromEntries(entries)],
          subagentTranscripts: [],
        },
        batch,
      );
      streamingEntryId = null;
      agentTranscripts.forgetAll();
      compaction.reset();
      return batch.cursor;
    },
    applySubagent,
    applySubagentEvent(agentId, event) {
      return emit(agentTranscripts.apply(agentId, event));
    },
    applyEvent(event) {
      switch (event.type) {
        case "agent_start":
          abortRequested = false;
          return emit([setRunState({ kind: RunStateKind.Streaming })]);
        case "agent_settled":
          return projection.runState.kind === RunStateKind.Streaming ||
            projection.runState.kind === RunStateKind.Retrying
            ? emit([setRunState(IDLE_RUN_STATE)])
            : [];
        case "auto_retry_start":
          return emit([
            setRunState({
              kind: RunStateKind.Retrying,
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              errorMessage: event.errorMessage,
              delayMs: event.delayMs,
            }),
          ]);
        case "auto_retry_end":
          if (abortRequested) {
            return emit([setRunState({ kind: RunStateKind.Aborted })]);
          }
          return event.success
            ? emit([setRunState({ kind: RunStateKind.Streaming })])
            : emit([
                setRunState({
                  kind: RunStateKind.Errored,
                  message: event.finalError ?? "the retry failed",
                }),
              ]);
        case "message_start":
          return onMessageStart(event);
        case "message_update":
          return onMessageUpdate(event);
        case "message_end":
          return onMessageEnd(event);
        case "agent_end":
          return onAgentEnd(event);
        case "entry_appended":
          return workflow.settled(event.entry);
        case "bash_execution_update":
          return bash.append(event.delta);
        case "compaction_start":
          return compaction.begin();
        case "compaction_end":
          return compaction.end(event);
        default:
          return [];
      }
    },
    markAborted() {
      abortRequested = true;
      streamingEntryId = null;
      compaction.reset();
      // An abort while nothing is running already belongs to a settled Session, so it would only
      // paint an Aborted row for a turn that was never asked to stop.
      if (
        projection.runState.kind !== RunStateKind.Streaming &&
        projection.runState.kind !== RunStateKind.Retrying
      ) {
        return [];
      }
      return emit([setRunState({ kind: RunStateKind.Aborted })]);
    },
    markCrashed(exit) {
      // The streamed message died with the child, so the provisional row it was building can never be
      // completed; the durable entry the child persisted before it went is what a reseed restores.
      streamingEntryId = null;
      abortRequested = false;
      compaction.reset();
      return emit([setRunState({ kind: RunStateKind.Crashed, ...exit })]);
    },
  };
}

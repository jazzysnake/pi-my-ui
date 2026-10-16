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
  MessageRole,
  ProjectionDeltaKind,
  RunStateKind,
  ToolCallStatus,
  reduceDeltaBatch,
  type ContentBlock,
  type ProjectedEntry,
  type ProjectionDelta,
  type RunState,
  type SessionProjection,
} from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";

import { blocksFromMessage, projectionBatch, toolResultOutput } from "./projection.js";

type AgentMessage = Extract<JsonAgentSessionEvent, { readonly type: "message_start" }>["message"];
type MessageStartEvent = Extract<JsonAgentSessionEvent, { readonly type: "message_start" }>;
type MessageEndEvent = Extract<JsonAgentSessionEvent, { readonly type: "message_end" }>;
type MessageUpdateEvent = Extract<JsonAgentSessionEvent, { readonly type: "message_update" }>;
type AgentEndEvent = Extract<JsonAgentSessionEvent, { readonly type: "agent_end" }>;

const IDLE_RUN_STATE: RunState = { kind: RunStateKind.Idle };

/** How a message's role maps to the transcript; roles with no row return `undefined`. */
function roleOf(message: AgentMessage): MessageRole | undefined {
  if (message.role === "user") {
    return MessageRole.User;
  }
  if (message.role === "assistant") {
    return MessageRole.Assistant;
  }
  if (message.role === "toolResult") {
    return MessageRole.ToolResult;
  }
  if (message.role === "custom") {
    return message.display === false ? undefined : MessageRole.Notification;
  }
  return undefined;
}

export interface SessionProjectionMachine {
  readonly projection: SessionProjection;
  /** Seed from pi's durable entries; returns the Cursor the seeded Projection sits at. */
  seed(entries: readonly SessionEntry[], leafId: string | null): number;
  applyEvent(event: JsonAgentSessionEvent): readonly ProjectionDelta[];
  markAborted(): readonly ProjectionDelta[];
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
  };
  let streamingEntryId: string | null = null;
  let pendingId = 0;
  let abortRequested = false;

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
      upsert({
        id,
        parentId: projection.leafId,
        role,
        timestamp: Date.now(),
        blocks: blocksFromMessage(message),
      }),
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
      if (entry !== undefined && entry.role === MessageRole.Assistant) {
        return { id, blocks: entry.blocks, deltas: [] };
      }
    }
    const newId = nextId();
    streamingEntryId = newId;
    return {
      id: newId,
      blocks: [],
      deltas: [
        upsert({
          id: newId,
          parentId: projection.leafId,
          role: MessageRole.Assistant,
          timestamp: Date.now(),
          blocks: [],
        }),
        setLeaf(newId),
      ],
    };
  }

  function setBlock(
    blocks: readonly ContentBlock[],
    index: number,
    block: ContentBlock,
  ): readonly ContentBlock[] {
    const next = [...blocks];
    while (next.length < index) {
      next.push({ type: ContentBlockType.Text, text: "" });
    }
    next[index] = block;
    return next;
  }

  function appendBlock(
    blocks: readonly ContentBlock[],
    index: number,
    type: typeof ContentBlockType.Text | typeof ContentBlockType.Reasoning,
    delta: string,
  ): readonly ContentBlock[] {
    const existing = blocks[index];
    if (existing !== undefined && existing.type === type) {
      return setBlock(blocks, index, { type, text: existing.text + delta });
    }
    return setBlock(blocks, index, { type, text: delta });
  }

  function withStreamingBlocks(
    update: (blocks: readonly ContentBlock[]) => readonly ContentBlock[],
  ): readonly ProjectionDelta[] {
    const streaming = ensureStreamingAssistant();
    const entry: ProjectedEntry = {
      id: streaming.id,
      parentId: entryById(streaming.id)?.parentId ?? projection.leafId,
      role: MessageRole.Assistant,
      timestamp: entryById(streaming.id)?.timestamp ?? Date.now(),
      blocks: update(streaming.blocks),
    };
    return emit([...streaming.deltas, upsert(entry)]);
  }

  function onMessageStart(event: MessageStartEvent): readonly ProjectionDelta[] {
    const role = roleOf(event.message);
    if (role !== MessageRole.Assistant) {
      return [];
    }
    const id = nextId();
    streamingEntryId = id;
    return emit([
      upsert({
        id,
        parentId: projection.leafId,
        role: MessageRole.Assistant,
        timestamp: Date.now(),
        blocks: [],
      }),
      setLeaf(id),
    ]);
  }

  function onToolResult(
    message: Extract<AgentMessage, { readonly role: "toolResult" }>,
  ): readonly ProjectionDelta[] {
    for (const entry of projection.entries) {
      if (entry.role !== MessageRole.Assistant) {
        continue;
      }
      const index = entry.blocks.findIndex(
        (block) => block.type === ContentBlockType.ToolCall && block.id === message.toolCallId,
      );
      const block = entry.blocks[index];
      if (block === undefined || block.type !== ContentBlockType.ToolCall) {
        continue;
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
    return [];
  }

  function onMessageEnd(event: MessageEndEvent): readonly ProjectionDelta[] {
    const message = event.message;
    if (message.role === "toolResult") {
      const folded = onToolResult(message);
      // A result whose call is not on the path (an abandoned branch) keeps its own row.
      return folded.length > 0 ? folded : appendMessage(message);
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
      upsert({
        id,
        parentId: existing?.parentId ?? projection.leafId,
        role: MessageRole.Assistant,
        timestamp: existing?.timestamp ?? Date.now(),
        blocks,
      }),
    ]);
  }

  function onMessageUpdate(event: MessageUpdateEvent): readonly ProjectionDelta[] {
    const update = event.assistantMessageEvent;
    switch (update.type) {
      case "text_start":
        return withStreamingBlocks((blocks) =>
          setBlock(blocks, update.contentIndex, { type: ContentBlockType.Text, text: "" }),
        );
      case "text_delta":
        return withStreamingBlocks((blocks) =>
          appendBlock(blocks, update.contentIndex, ContentBlockType.Text, update.delta),
        );
      case "text_end":
        return withStreamingBlocks((blocks) =>
          setBlock(blocks, update.contentIndex, {
            type: ContentBlockType.Text,
            text: update.content,
          }),
        );
      case "thinking_start":
        return withStreamingBlocks((blocks) =>
          setBlock(blocks, update.contentIndex, { type: ContentBlockType.Reasoning, text: "" }),
        );
      case "thinking_delta":
        return withStreamingBlocks((blocks) =>
          appendBlock(blocks, update.contentIndex, ContentBlockType.Reasoning, update.delta),
        );
      case "thinking_end":
        return withStreamingBlocks((blocks) =>
          setBlock(blocks, update.contentIndex, {
            type: ContentBlockType.Reasoning,
            text: update.content,
          }),
        );
      case "toolcall_start":
        return withStreamingBlocks((blocks) =>
          setBlock(blocks, update.contentIndex, {
            type: ContentBlockType.ToolCall,
            id: update.id,
            name: update.toolName,
            arguments: {},
            status: ToolCallStatus.Running,
          }),
        );
      case "toolcall_delta":
        // Arguments arrive as partial JSON; the end event carries the parsed call.
        return [];
      case "toolcall_end":
        return withStreamingBlocks((blocks) =>
          setBlock(blocks, update.contentIndex, {
            type: ContentBlockType.ToolCall,
            id: update.toolCall.id,
            name: update.toolCall.name,
            arguments: update.toolCall.arguments,
            status: ToolCallStatus.Running,
          }),
        );
      case "start":
      case "done":
      case "error":
        return [];
    }
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
    seed(entries, leafId) {
      const batch = projectionBatch({ entries, leafId, fromCursor: 0 });
      projection = reduceDeltaBatch(
        { sessionId, cwd, leafId: null, entries: [], runState: IDLE_RUN_STATE },
        batch,
      );
      streamingEntryId = null;
      return batch.cursor;
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
        default:
          return [];
      }
    },
    markAborted() {
      abortRequested = true;
      streamingEntryId = null;
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
  };
}

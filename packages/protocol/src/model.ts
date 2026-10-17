/**
 * The Projection the browser renders and the Deltas that change it. A Projection is a full view of
 * one Session at a Cursor; a Delta batch is the ordered change that takes a receiver from one Cursor
 * to the next.
 */

import {
  CommandSource,
  ContentBlockType,
  MessageRole,
  ProjectionDeltaKind,
  RunStateKind,
  SessionActivity,
  ToolCallStatus,
} from "./constants.js";

/** A position in one Session's ordered stream of Delta batches. */
export type Cursor = number;

/**
 * One image the user attached, base64-encoded so it survives JSON. The wire receives a fixed size
 * bound and a media-type whitelist at the boundary; the client never sends a file path.
 */
export interface ImageAttachment {
  /** The image's IANA media type, e.g. `image/png`. */
  readonly mediaType: string;
  /** The image bytes, base64-encoded. */
  readonly data: string;
}

/** One model pi can be switched to, as the status strip's picker lists it. */
export interface ModelInfo {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
}

/** One discoverable command pi offers for the palette: a prompt template, skill or extension command. */
export interface CommandInfo {
  readonly name: string;
  readonly description: string;
  readonly source: CommandSource;
}

/** Context-window usage as pi reports it; `tokens` is null when pi cannot estimate it. */
export interface ContextUsage {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
}

/** Token totals one Session has spent, in pi's own four buckets. */
export interface SessionTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

/** One Session's statistics for the session panel; every value is pi's, never a client estimate. */
export interface SessionStats {
  readonly sessionId: string;
  readonly sessionFile: string | null;
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly totalMessages: number;
  readonly tokens: SessionTokenUsage;
  readonly cost: number;
  readonly contextUsage: ContextUsage | null;
}

/** A block of user/assistant/tool text. */
export interface TextBlock {
  readonly type: typeof ContentBlockType.Text;
  readonly text: string;
}

/** A reasoning block, rendered collapsed by default. */
export interface ReasoningBlock {
  readonly type: typeof ContentBlockType.Reasoning;
  readonly text: string;
}

/** A tool call as the transcript shows it. */
export interface ToolCallBlock {
  readonly type: typeof ContentBlockType.ToolCall;
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly status: ToolCallStatus;
  /** The tool's visible output, present once its result has arrived. */
  readonly output?: string;
}

/** How a finished shell command ended, as pi reports it. */
export interface BashExecutionResult {
  /** The command's exit code, or `null` when pi could not report one (a signal ended it). */
  readonly exitCode: number | null;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  /** pi's own spill file for output past its truncation bound, in pi's temporary directory. */
  readonly fullOutputPath?: string;
}

/**
 * One direct shell command (`!`/`!!`) as a bash card shows it. `commandId` is stable across the live
 * stream and a resync, so the card keeps its identity instead of being re-created per chunk.
 */
export interface BashExecutionBlock {
  readonly type: typeof ContentBlockType.BashExecution;
  readonly commandId: string;
  readonly command: string;
  /** `true` for `!!`: the output stays out of the model's context. */
  readonly excludeFromContext: boolean;
  /** The accumulated output; it grows while the command runs. */
  readonly output: string;
  /** Absent while the command runs; present once pi reports how it ended. */
  readonly result?: BashExecutionResult;
}

/** Any projected content block. */
export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | BashExecutionBlock;

/** One message in a transcript. */
export interface ProjectedEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly role: MessageRole;
  readonly timestamp: number;
  readonly blocks: readonly ContentBlock[];
}

/** One ordered change to a {@link SessionProjection}. */
export type ProjectionDelta =
  | { readonly kind: typeof ProjectionDeltaKind.EntryUpsert; readonly entry: ProjectedEntry }
  | { readonly kind: typeof ProjectionDeltaKind.EntryRemoved; readonly entryId: string }
  | { readonly kind: typeof ProjectionDeltaKind.LeafChanged; readonly leafId: string | null }
  | { readonly kind: typeof ProjectionDeltaKind.RunState; readonly runState: RunState };

/** What a Session's run is doing. `aborted` and `errored` linger until the next run starts. */
export type RunState =
  | { readonly kind: typeof RunStateKind.Idle }
  | { readonly kind: typeof RunStateKind.Streaming }
  | {
      readonly kind: typeof RunStateKind.Retrying;
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly errorMessage: string;
      readonly delayMs: number;
    }
  | { readonly kind: typeof RunStateKind.Aborted }
  | { readonly kind: typeof RunStateKind.Errored; readonly message: string };

/**
 * The one definition of "this Session is working", from the run state the Projection holds. The
 * server's activity signal and a client's reading of a Snapshot both use it, so a row can never
 * disagree with the transcript beside it.
 */
export function sessionActivityOf(runState: RunState): SessionActivity {
  return runState.kind === RunStateKind.Streaming || runState.kind === RunStateKind.Retrying
    ? SessionActivity.Working
    : SessionActivity.Idle;
}

/** A cursor-addressed, ordered group of deltas. */
export interface DeltaBatch {
  readonly fromCursor: Cursor;
  readonly cursor: Cursor;
  readonly deltas: readonly ProjectionDelta[];
}

/**
 * One Session as a list row shows it: disk facts only. The transcript's live state arrives in that
 * Session's Projection, never here, so a refreshed list cannot overwrite what the browser is watching.
 */
export interface SessionSummary {
  readonly id: string;
  /** The user-set name (pi's `session_info`), or `null` when the Session has none. */
  readonly name: string | null;
  /** The first user message, whitespace-collapsed and truncated, or `null` when there is none. */
  readonly firstMessage: string | null;
  /** The Session file's last activity, in epoch milliseconds. */
  readonly lastActivityAt: number;
}

/** One Session's projected state, as a Snapshot carries it and Deltas advance it. */
export interface SessionProjection {
  readonly sessionId: string;
  readonly cwd: string;
  readonly leafId: string | null;
  readonly entries: readonly ProjectedEntry[];
  readonly runState: RunState;
}

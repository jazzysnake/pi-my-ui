/**
 * The Projection the browser renders and the Deltas that change it. A Projection is a full view of
 * one Session at a Cursor; a Delta batch is the ordered change that takes a receiver from one Cursor
 * to the next.
 */

import { ContentBlockType, MessageRole, ProjectionDeltaKind, RunStateKind } from "./constants.js";

/** A position in one Session's ordered stream of Delta batches. */
export type Cursor = number;

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
}

/** Any projected content block. */
export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock;

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

/** A cursor-addressed, ordered group of deltas. */
export interface DeltaBatch {
  readonly fromCursor: Cursor;
  readonly cursor: Cursor;
  readonly deltas: readonly ProjectionDelta[];
}

/** One Session's projected state, as a Snapshot carries it and Deltas advance it. */
export interface SessionProjection {
  readonly sessionId: string;
  readonly cwd: string;
  readonly leafId: string | null;
  readonly entries: readonly ProjectedEntry[];
  readonly runState: RunState;
}

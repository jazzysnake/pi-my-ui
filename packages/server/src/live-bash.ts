/**
 * The live half of a `!`/`!!` command: one card that opens when the command is sent, grows as pi
 * streams output, and closes with pi's result. Keeping it beside the message stream reducer stops
 * the reducer from also owning a second, unrelated lifecycle.
 */

import {
  ContentBlockType,
  MessageRole,
  type BashExecutionResult,
  type ProjectedEntry,
  type ProjectionDelta,
} from "@pi-my-ui/protocol";

/** The Projection operations a live command needs, injected so this module owns no reducer state. */
export interface LiveBashHost {
  nextId(): string;
  entry(id: string): ProjectedEntry | undefined;
  leafId(): string | null;
  emit(deltas: readonly ProjectionDelta[]): readonly ProjectionDelta[];
  upsert(entry: ProjectedEntry): ProjectionDelta;
  setLeaf(leafId: string | null): ProjectionDelta;
  remove(entryId: string): ProjectionDelta;
}

interface ActiveBash {
  readonly id: string;
  readonly command: string;
  readonly excludeFromContext: boolean;
  output: string;
}

export interface LiveBash {
  begin(command: string, excludeFromContext: boolean): readonly ProjectionDelta[];
  append(delta: string): readonly ProjectionDelta[];
  end(output: string, result: BashExecutionResult): readonly ProjectionDelta[];
  /** Drop a card whose command never reached pi, so a failed send leaves no phantom. */
  discard(): readonly ProjectionDelta[];
  reset(): void;
}

export function createLiveBash(host: LiveBashHost): LiveBash {
  let active: ActiveBash | null = null;

  function entry(bash: ActiveBash, result?: BashExecutionResult): ProjectedEntry {
    const existing = host.entry(bash.id);
    return {
      id: bash.id,
      parentId: existing?.parentId ?? host.leafId(),
      role: MessageRole.Bash,
      timestamp: existing?.timestamp ?? Date.now(),
      blocks: [
        {
          type: ContentBlockType.BashExecution,
          commandId: bash.id,
          command: bash.command,
          excludeFromContext: bash.excludeFromContext,
          output: bash.output,
          ...(result === undefined ? {} : { result }),
        },
      ],
    };
  }

  function finish(bash: ActiveBash, result?: BashExecutionResult): readonly ProjectionDelta[] {
    active = null;
    return host.emit([host.upsert(entry(bash, result))]);
  }

  return {
    begin(command, excludeFromContext) {
      if (active !== null) {
        throw new Error("a shell command is already running in this Session");
      }
      const bash: ActiveBash = { id: host.nextId(), command, excludeFromContext, output: "" };
      active = bash;
      return host.emit([host.upsert(entry(bash)), host.setLeaf(bash.id)]);
    },
    append(delta) {
      const bash = active;
      if (bash === null) {
        return [];
      }
      bash.output += delta;
      return host.emit([host.upsert(entry(bash))]);
    },
    end(output, result) {
      const bash = active;
      if (bash === null) {
        return [];
      }
      // The live stream can carry more than pi's truncated final output, so it wins when present.
      if (bash.output === "") {
        bash.output = output;
      }
      return finish(bash, result);
    },
    discard() {
      const bash = active;
      if (bash === null) {
        return [];
      }
      const existing = host.entry(bash.id);
      active = null;
      if (existing === undefined) {
        return [];
      }
      return host.emit([host.remove(bash.id), host.setLeaf(existing.parentId)]);
    },
    reset() {
      active = null;
    },
  };
}

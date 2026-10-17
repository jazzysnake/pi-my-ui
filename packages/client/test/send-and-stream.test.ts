import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it, vi } from "vitest";

import {
  ProjectionDeltaKind,
  RunStateKind,
  ServerMessageType,
  type DeltaMessage,
  type ProjectedEntry,
  type ProjectionDelta,
  type RunState,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

const IDLE: RunState = { kind: RunStateKind.Idle };

/** A Snapshot as the server would send it, so these tests exercise the store input, not a socket. */
function snapshotOf(entries: readonly ProjectedEntry[]): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: "session-1",
    cursor: entries.length,
    projection: {
      sessionId: "session-1",
      cwd: "/workspace",
      leafId: entries.at(-1)?.id ?? null,
      entries,
      runState: IDLE,
      subagents: [],
    },
  };
}

function deltaOf(deltas: readonly ProjectionDelta[], fromCursor: number): DeltaMessage {
  return {
    type: ServerMessageType.Delta,
    sessionId: "session-1",
    fromCursor,
    cursor: fromCursor + deltas.length,
    deltas,
  };
}

function userEntry(id: string, text: string): ProjectedEntry {
  return {
    id,
    parentId: null,
    role: "user",
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

function assistantEntry(id: string, text: string, reasoning?: string): ProjectedEntry {
  return {
    id,
    parentId: "entry-1",
    role: "assistant",
    timestamp: 1,
    blocks: [
      ...(reasoning === undefined ? [] : [{ type: "reasoning" as const, text: reasoning }]),
      { type: "text" as const, text },
    ],
  };
}

interface Mounted {
  readonly target: HTMLElement;
  readonly prompt: ReturnType<typeof vi.fn>;
  readonly abort: ReturnType<typeof vi.fn>;
}

function mountShell(store: ClientStore, status: ConnectionStatus): Mounted {
  const prompt = vi.fn();
  const abort = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status,
        onPrompt: prompt,
        onAbort: abort,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: () => undefined,
      },
    });
  });
  return { target, prompt, abort };
}

function runStateRow(target: HTMLElement): Element | null {
  return target.querySelector('[data-testid="run-state"]');
}

describe("streaming a reply into the transcript", () => {
  it("applies streamed text and reasoning blocks as Deltas arrive", () => {
    const store = new ClientStore();
    const { target } = mountShell(store, ConnectionStatus.Connected);
    flushSync(() => {
      store.receive(snapshotOf([userEntry("entry-1", "hello")]));
    });

    flushSync(() => {
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.EntryUpsert,
              entry: assistantEntry("entry-2", "Hel", "thinking hard"),
            },
          ],
          1,
        ),
      );
    });
    const reasoning = target.querySelector('[data-testid="reasoning-block"]');
    expect(reasoning?.textContent).toContain("thinking hard");
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).toContain("Hel");

    flushSync(() => {
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.EntryUpsert,
              entry: assistantEntry("entry-2", "Hello there", "thinking hard"),
            },
          ],
          2,
        ),
      );
    });
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).toContain(
      "Hello there",
    );
    // The streamed update replaced the same row rather than appending a second one.
    expect(target.querySelectorAll('[data-testid="transcript-entry"]')).toHaveLength(2);
  });
});

describe("run states in the transcript", () => {
  it("renders a retry with the protocol's attempt count", () => {
    const store = new ClientStore();
    const { target } = mountShell(store, ConnectionStatus.Connected);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.RunState,
              runState: {
                kind: RunStateKind.Retrying,
                attempt: 1,
                maxAttempts: 3,
                errorMessage: "529 overloaded",
                delayMs: 2000,
              },
            },
          ],
          0,
        ),
      );
    });

    expect(runStateRow(target)?.getAttribute("data-run-state")).toBe(RunStateKind.Retrying);
    expect(target.querySelector('[data-testid="run-state-label"]')?.textContent).toBe("Retrying");
    expect(target.querySelector('[data-testid="run-state-detail"]')?.textContent).toBe(
      "Attempt 1 of 3 · 529 overloaded",
    );
  });

  it("renders the error and aborted states distinctly", () => {
    const store = new ClientStore();
    const { target } = mountShell(store, ConnectionStatus.Connected);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.RunState,
              runState: { kind: RunStateKind.Errored, message: "the model exploded" },
            },
          ],
          0,
        ),
      );
    });
    expect(runStateRow(target)?.getAttribute("data-run-state")).toBe(RunStateKind.Errored);
    expect(target.querySelector('[data-testid="run-state-label"]')?.textContent).toBe("Error");
    expect(target.querySelector('[data-testid="run-state-detail"]')?.textContent).toBe(
      "the model exploded",
    );

    flushSync(() => {
      store.receive(
        deltaOf(
          [{ kind: ProjectionDeltaKind.RunState, runState: { kind: RunStateKind.Aborted } }],
          1,
        ),
      );
    });
    expect(runStateRow(target)?.getAttribute("data-run-state")).toBe(RunStateKind.Aborted);
    expect(target.querySelector('[data-testid="run-state-label"]')?.textContent).toBe("Aborted");
    expect(target.querySelector('[data-testid="run-state-detail"]')?.textContent).toBe(
      "stopped by you",
    );
  });

  it("renders no row for idle and streaming", () => {
    const store = new ClientStore();
    const { target } = mountShell(store, ConnectionStatus.Connected);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    expect(runStateRow(target)).toBeNull();

    flushSync(() => {
      store.receive(
        deltaOf(
          [{ kind: ProjectionDeltaKind.RunState, runState: { kind: RunStateKind.Streaming } }],
          0,
        ),
      );
    });
    expect(runStateRow(target)).toBeNull();
  });
});

describe("the composer", () => {
  it("sends the typed text", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store, ConnectionStatus.Connected);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    const input = target.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    const send = target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]');
    if (input === null || send === null) {
      throw new Error("the composer is missing");
    }
    input.value = "hello agent";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync(() => {
      send.click();
    });

    expect(prompt).toHaveBeenCalledWith("hello agent", [], undefined);
  });

  it("turns send into stop while a run is active and aborts it", () => {
    const store = new ClientStore();
    const { target, prompt, abort } = mountShell(store, ConnectionStatus.Connected);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(
        deltaOf(
          [{ kind: ProjectionDeltaKind.RunState, runState: { kind: RunStateKind.Streaming } }],
          0,
        ),
      );
    });

    const send = target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]');
    if (send === null) {
      throw new Error("the composer is missing");
    }
    expect(send.textContent?.trim()).toBe("Stop");
    flushSync(() => {
      send.click();
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

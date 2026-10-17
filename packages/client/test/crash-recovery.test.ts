import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it, vi } from "vitest";

import {
  EntryKind,
  ProjectionDeltaKind,
  RunStateKind,
  ServerMessageType,
  type ProjectedEntry,
  type ProjectionDelta,
  type RunState,
  type ServerMessage,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";

const SESSION_ID = "session-1";

/** A Snapshot as the server would send it, so these tests exercise the store input, not a socket. */
export function snapshotOf(
  entries: readonly ProjectedEntry[],
  runState: RunState = { kind: RunStateKind.Idle },
): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: SESSION_ID,
    cursor: entries.length,
    projection: {
      sessionId: SESSION_ID,
      cwd: "/workspace",
      leafId: entries.at(-1)?.id ?? null,
      entries,
      runState,
      subagents: [],
      subagentTranscripts: [],
    },
  };
}

function runStateDelta(deltas: readonly ProjectionDelta[], fromCursor: number): ServerMessage {
  return {
    type: ServerMessageType.Delta,
    sessionId: SESSION_ID,
    fromCursor,
    cursor: fromCursor + deltas.length,
    deltas,
  };
}

function entryOf(id: string, text: string): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id,
    parentId: null,
    role: "user",
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

interface Mounted {
  readonly target: HTMLElement;
  readonly reconnect: ReturnType<typeof vi.fn>;
}

function mountShell(store: ClientStore): Mounted {
  const reconnect = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status: ConnectionStatus.Connected,
        onSelectSession: (sessionId: string) => {
          store.selectSession(sessionId);
        },
        onPrompt: () => undefined,
        onAbort: () => undefined,
        onReconnect: reconnect,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: () => undefined,
      },
    });
  });
  return { target, reconnect };
}

function row(target: HTMLElement): Element | null {
  return target.querySelector('[data-testid="run-state"]');
}

function label(target: HTMLElement): string | null | undefined {
  return target.querySelector('[data-testid="run-state-label"]')?.textContent;
}

function detail(target: HTMLElement): string | null | undefined {
  return target.querySelector('[data-testid="run-state-detail"]')?.textContent;
}

function reconnectControl(target: HTMLElement): HTMLButtonElement | null {
  return target.querySelector<HTMLButtonElement>('[data-testid="session-reconnect"]');
}

const CRASHED: RunState = { kind: RunStateKind.Crashed, exitCode: null, signal: "SIGKILL" };

describe("a Session whose Pi child is gone", () => {
  it("shows the exit details and a Reconnect control that respawns it", () => {
    const store = new ClientStore();
    const { target, reconnect } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([entryOf("entry-1", "seed text")]));
      store.receive(runStateDelta([{ kind: ProjectionDeltaKind.RunState, runState: CRASHED }], 1));
    });

    expect(row(target)?.getAttribute("data-run-state")).toBe(RunStateKind.Crashed);
    expect(label(target)).toBe("Pi child exited");
    expect(detail(target)).toBe("signal SIGKILL");

    flushSync(() => {
      reconnectControl(target)?.click();
    });
    expect(reconnect).toHaveBeenCalledTimes(1);
    // Waiting for the respawn reads as starting, not as the crash that is being recovered from.
    expect(row(target)?.getAttribute("data-run-state")).toBe("starting");
    expect(label(target)).toBe("Starting…");
    expect(reconnectControl(target)).toBeNull();
    // The transcript is not thrown away by the recovery: the file it came from is intact.
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).toContain("seed text");

    flushSync(() => {
      store.receive(snapshotOf([entryOf("entry-1", "seed text")]));
    });
    expect(row(target)).toBeNull();
    expect(reconnectControl(target)).toBeNull();
  });

  it("reports an exit code when pi exited by itself", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(
        runStateDelta(
          [
            {
              kind: ProjectionDeltaKind.RunState,
              runState: { kind: RunStateKind.Crashed, exitCode: 1, signal: null },
            },
          ],
          0,
        ),
      );
    });

    expect(detail(target)).toBe("exit code 1");
    expect(reconnectControl(target)).not.toBeNull();
  });

  it("returns to the crash when the respawn is refused rather than pretending it started", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(runStateDelta([{ kind: ProjectionDeltaKind.RunState, runState: CRASHED }], 0));
    });
    flushSync(() => {
      reconnectControl(target)?.click();
    });
    expect(row(target)?.getAttribute("data-run-state")).toBe("starting");

    flushSync(() => {
      store.receive({
        type: ServerMessageType.Error,
        sessionId: SESSION_ID,
        error: { code: "unknownSession", message: "unknown session" },
      });
    });
    expect(row(target)?.getAttribute("data-run-state")).toBe(RunStateKind.Crashed);
    expect(reconnectControl(target)).not.toBeNull();
  });

  it("says a Session is Starting… before its first Snapshot and does not style it as an error", () => {
    const store = new ClientStore();
    store.selectSession(SESSION_ID);
    const { target } = mountShell(store);

    expect(row(target)?.getAttribute("data-run-state")).toBe("starting");
    expect(label(target)).toBe("Starting…");
    expect(detail(target)).toBeUndefined();
    const labelElement = target.querySelector('[data-testid="run-state-label"]');
    expect(labelElement?.className).not.toMatch(/red/);
  });
});

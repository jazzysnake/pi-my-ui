import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  RunStateKind,
  ServerMessageType,
  type ProjectedEntry,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { SESSION_ID, deltaOf, input, mountShell, type } from "./composer-harness.js";

const TOKENS_BEFORE = 29_539;

function messageEntry(
  id: string,
  role: typeof MessageRole.User | typeof MessageRole.Assistant,
  text: string,
): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id,
    parentId: null,
    role,
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

function boundaryEntry(id: string): ProjectedEntry {
  return {
    kind: EntryKind.CompactionBoundary,
    id,
    parentId: "u1",
    timestamp: 0,
    summary: "The agent had already read the API surface.",
    tokensBefore: TOKENS_BEFORE,
    firstKeptEntryId: "a1",
  };
}

function snapshotOf(entries: readonly ProjectedEntry[]): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: SESSION_ID,
    cursor: entries.length,
    projection: {
      sessionId: SESSION_ID,
      cwd: "/workspace",
      leafId: entries.at(-1)?.id ?? null,
      entries,
      runState: { kind: RunStateKind.Idle },
      subagents: [],
    },
  };
}

function entryIds(target: HTMLElement): (string | null)[] {
  return [...target.querySelectorAll('[data-testid="transcript-entry"]')].map((row) =>
    row.getAttribute("data-entry-id"),
  );
}

function readout(target: HTMLElement): Element | null {
  return target.querySelector('[data-testid="context-usage"]');
}

describe("a compaction boundary in the transcript", () => {
  it("sits where compaction happened and names the context it replaced", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(
        snapshotOf([
          messageEntry("u1", MessageRole.User, "read the API"),
          boundaryEntry("c1"),
          messageEntry("a1", MessageRole.Assistant, "done"),
        ]),
      );
    });

    expect(entryIds(target)).toEqual(["u1", "c1", "a1"]);
    const boundary = target.querySelector('[data-testid="compaction-boundary"]');
    expect(boundary?.getAttribute("data-tokens-before")).toBe(String(TOKENS_BEFORE));
    expect(target.querySelector('[data-testid="compaction-boundary-label"]')?.textContent).toBe(
      "Context compacted here",
    );
    expect(boundary?.textContent).toContain("The agent had already read the API surface.");
    // A boundary is not a message, so it carries no copy control of its own.
    expect(boundary?.querySelector('[data-testid="copy-raw"]')).toBeNull();
  });
});

describe("compaction in progress", () => {
  it("shows the compaction as the transcript's run state", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(
        deltaOf(
          [{ kind: ProjectionDeltaKind.RunState, runState: { kind: RunStateKind.Compacting } }],
          0,
        ),
      );
    });

    const row = target.querySelector('[data-testid="run-state"]');
    expect(row?.getAttribute("data-run-state")).toBe(RunStateKind.Compacting);
    expect(target.querySelector('[data-testid="run-state-label"]')?.textContent).toBe(
      "Compacting context",
    );
    // Nothing failed, so the compaction offers no recovery control.
    expect(target.querySelector('[data-testid="session-reconnect"]')).toBeNull();
  });
});

describe("the session bar's context readout", () => {
  it("shows pi's figure, its thresholds, and a figure pi is recomputing", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    expect(readout(target)).toBeNull();

    flushSync(() => {
      store.receive({
        type: ServerMessageType.ContextUsage,
        sessionId: SESSION_ID,
        contextUsage: { tokens: 30_000, contextWindow: 200_000, percent: 15 },
      });
    });
    expect(readout(target)?.getAttribute("data-state")).toBe("normal");
    expect(readout(target)?.textContent).toContain("30k / 200k");
    expect(readout(target)?.textContent).toContain("15%");

    flushSync(() => {
      store.receive({
        type: ServerMessageType.ContextUsage,
        sessionId: SESSION_ID,
        contextUsage: { tokens: 150_000, contextWindow: 200_000, percent: 75 },
      });
    });
    expect(readout(target)?.getAttribute("data-state")).toBe("warning");

    flushSync(() => {
      store.receive({
        type: ServerMessageType.ContextUsage,
        sessionId: SESSION_ID,
        contextUsage: { tokens: 180_000, contextWindow: 200_000, percent: 90 },
      });
    });
    expect(readout(target)?.getAttribute("data-state")).toBe("critical");

    // pi reports null tokens until a post-compaction turn gives it a fresh figure.
    flushSync(() => {
      store.receive({
        type: ServerMessageType.ContextUsage,
        sessionId: SESSION_ID,
        contextUsage: { tokens: null, contextWindow: 200_000, percent: null },
      });
    });
    expect(readout(target)?.getAttribute("data-state")).toBe("recalculating");
    expect(readout(target)?.textContent).toContain("Recalculating…");

    // No model or context window: there is no figure and none is coming.
    flushSync(() => {
      store.receive({
        type: ServerMessageType.ContextUsage,
        sessionId: SESSION_ID,
        contextUsage: null,
      });
    });
    expect(readout(target)?.getAttribute("data-state")).toBe("unavailable");
    expect(readout(target)?.textContent).toContain("unavailable");
  });

  it("drops the previous Session's figure when the view switches", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive({
        type: ServerMessageType.ContextUsage,
        sessionId: SESSION_ID,
        contextUsage: { tokens: 30_000, contextWindow: 200_000, percent: 15 },
      });
    });
    expect(readout(target)).not.toBeNull();

    flushSync(() => {
      store.selectSession("session-2");
    });
    expect(readout(target)).toBeNull();
  });
});

describe("sending /compact", () => {
  it("runs the compaction with the instructions typed after the command", () => {
    const store = new ClientStore();
    const { target, compact } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    type(target, "/compact keep the API surface");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });

    expect(compact).toHaveBeenCalledWith("keep the API surface");
    expect(input(target).value).toBe("");
  });

  it("compacts with no instructions when the command stands alone", () => {
    const store = new ClientStore();
    const { target, compact } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    type(target, "/compact");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });

    expect(compact).toHaveBeenCalledWith(undefined);
  });
});

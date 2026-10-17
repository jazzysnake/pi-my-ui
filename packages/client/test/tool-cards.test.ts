import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  MessageRole,
  ServerMessageType,
  type ProjectedEntry,
  type SnapshotMessage,
  type ToolCallStatus,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

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
      runState: { kind: "idle" },
      subagents: [],
    },
  };
}

function toolCallEntry(id: string, status: ToolCallStatus, output?: string): ProjectedEntry {
  return {
    id,
    parentId: null,
    role: MessageRole.Assistant,
    timestamp: 0,
    blocks: [
      {
        type: "toolCall",
        id: `${id}-call`,
        name: "bash",
        arguments: { command: "ls" },
        status,
        ...(output === undefined ? {} : { output }),
      },
    ],
  };
}

function reasoningEntry(id: string, text: string): ProjectedEntry {
  return {
    id,
    parentId: null,
    role: MessageRole.Assistant,
    timestamp: 0,
    blocks: [{ type: "reasoning", text }],
  };
}

function mountShell(store: ClientStore): HTMLElement {
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status: ConnectionStatus.Connected,
        onSelectSession: () => undefined,
        onPrompt: () => undefined,
        onAbort: () => undefined,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: () => undefined,
      },
    });
  });
  return target;
}

describe("tool call cards", () => {
  it("shows a running tool call as a card", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([toolCallEntry("entry-1", "running")]));
    });

    const card = target.querySelector('[data-testid="tool-card"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-tool-status")).toBe("running");
    expect(card?.querySelector('[data-testid="tool-card-name"]')?.textContent).toBe("bash");
  });

  it("shows a completed tool call with its output", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([toolCallEntry("entry-1", "success", "listing.txt")]));
    });

    const card = target.querySelector('[data-testid="tool-card"]');
    expect(card?.getAttribute("data-tool-status")).toBe("success");
    expect(card?.querySelector('[data-testid="tool-card-output"]')?.textContent).toContain(
      "listing.txt",
    );
  });

  it("shows a failed tool call as an error card", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([toolCallEntry("entry-1", "error", "exit 1")]));
    });

    const card = target.querySelector('[data-testid="tool-card"]');
    expect(card?.getAttribute("data-tool-status")).toBe("error");
    expect(card?.querySelector('[data-testid="tool-card-output"]')?.textContent).toContain(
      "exit 1",
    );
  });
});

describe("reasoning blocks", () => {
  it("collapses reasoning by default and expands it on demand", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([reasoningEntry("entry-1", "Weighing the seams.")]));
    });

    const details = target.querySelector<HTMLDetailsElement>('[data-testid="reasoning-block"]');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    const summary = details?.querySelector("summary");
    if (summary === null || summary === undefined) {
      throw new Error("the reasoning block has no summary control");
    }
    flushSync(() => {
      summary.click();
    });
    expect(details?.open).toBe(true);
  });
});

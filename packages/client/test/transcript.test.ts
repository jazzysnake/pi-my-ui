import { flushSync, mount, type Component } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EntryKind,
  MessageRole,
  ServerMessageType,
  type ProjectedEntry,
  type ProjectedMessageEntry,
  type SnapshotMessage,
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
      subagentTranscripts: [],
    },
  };
}

function entry(id: string, role: ProjectedMessageEntry["role"], text: string): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id,
    parentId: null,
    role,
    timestamp: 0,
    blocks: [{ type: "text", text }],
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
        onBash: () => undefined,
        onAbort: () => undefined,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: () => undefined,
      },
    });
  });
  return target;
}

const ASSISTANT_MARKDOWN = [
  "# Rendering notes",
  "",
  "| Feature | State |",
  "| --- | --- |",
  "| tables | on |",
  "",
  "```ts",
  "const answer = 42;",
  "```",
].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("markdown in the transcript", () => {
  it("renders an assistant message's headings, tables and code blocks", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([entry("entry-1", MessageRole.Assistant, ASSISTANT_MARKDOWN)]));
    });

    const markdown = target.querySelector('[data-testid="markdown"]');
    expect(markdown).not.toBeNull();
    expect(markdown?.querySelector("h1")?.textContent).toBe("Rendering notes");
    expect(markdown?.querySelector("table")).not.toBeNull();
    expect(markdown?.querySelector("pre code")?.textContent).toContain("const answer = 42;");
  });

  it("keeps a user message's markdown literal", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([entry("entry-1", MessageRole.User, "# not a heading")]));
    });

    expect(target.querySelector('[data-testid="markdown"]')).toBeNull();
    expect(target.querySelector("h1")).toBeNull();
    expect(target.textContent).toContain("# not a heading");
  });

  it("copies a message's raw markdown to the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([entry("entry-1", MessageRole.Assistant, ASSISTANT_MARKDOWN)]));
    });

    const copy = target.querySelector<HTMLButtonElement>('[data-testid="copy-message"]');
    if (copy === null) {
      throw new Error("the message card's copy control is missing");
    }
    expect(copy.getAttribute("aria-label")).toBe("Copy message");
    expect(copy.closest('[data-testid="message-card"]')).not.toBeNull();
    flushSync(() => {
      copy.click();
    });

    expect(writeText).toHaveBeenCalledWith(ASSISTANT_MARKDOWN);
  });
});

describe("a Snapshot for another Session", () => {
  it("does not replace the transcript the slice is watching", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([entry("entry-1", MessageRole.User, "the watched session")]));
    });

    flushSync(() => {
      store.receive({
        type: ServerMessageType.Snapshot,
        sessionId: "session-2",
        cursor: 1,
        projection: {
          sessionId: "session-2",
          cwd: "/elsewhere",
          leafId: "other-1",
          entries: [entry("other-1", MessageRole.User, "a different session")],
          runState: { kind: "idle" },
          subagents: [],
          subagentTranscripts: [],
        },
      });
    });

    const transcript = target.querySelector('[data-testid="transcript"]');
    expect(transcript?.textContent).toContain("the watched session");
    expect(transcript?.textContent).not.toContain("a different session");
  });
});

describe("notifications in the transcript", () => {
  it("renders an extension message as a card named by its summary", () => {
    const store = new ClientStore();
    const target = mountShell(store);
    const payload = [
      "<task-notification>",
      "<status>Done</status>",
      '<summary>Agent "Find the parser" completed</summary>',
      "</task-notification>",
    ].join("\n");
    flushSync(() => {
      store.receive(snapshotOf([entry("entry-1", MessageRole.Notification, payload)]));
    });

    expect(target.querySelector('[data-testid="notification-card"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="notification-summary"]')?.textContent).toBe(
      'Agent "Find the parser" completed',
    );
    expect(target.querySelector('[data-testid="notification-payload"]')?.textContent).toContain(
      "<task-notification>",
    );
  });
});

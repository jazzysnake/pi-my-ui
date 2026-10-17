import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
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
      subagentTranscripts: [],
    },
  };
}

function toolEntry(
  id: string,
  name: string,
  status: ToolCallStatus,
  arguments_: Readonly<Record<string, unknown>>,
  output?: string,
): ProjectedEntry {
  return {
    id,
    parentId: null,
    kind: EntryKind.Message,
    role: MessageRole.Assistant,
    timestamp: 0,
    blocks: [
      {
        type: "toolCall",
        id: `${id}-call`,
        name,
        arguments: arguments_,
        status,
        ...(output === undefined ? {} : { output }),
      },
    ],
  };
}

function toolCallEntry(id: string, status: ToolCallStatus, output?: string): ProjectedEntry {
  return toolEntry(id, "bash", status, { command: "ls" }, output);
}

function reasoningEntry(id: string, text: string): ProjectedEntry {
  return {
    kind: EntryKind.Message,
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

/** Mount the shell over one snapshot, so each test reads a rendered transcript, not a store. */
function render(...entries: readonly ProjectedEntry[]): HTMLElement {
  const store = new ClientStore();
  const target = mountShell(store);
  flushSync(() => {
    store.receive(snapshotOf(entries));
  });
  return target;
}

function card(target: HTMLElement, index = 0): HTMLElement {
  const found = target.querySelectorAll<HTMLElement>('[data-testid="tool-card"]')[index];
  if (found === undefined) {
    throw new Error(`there is no tool card at index ${String(index)}`);
  }
  return found;
}

function part(target: HTMLElement, testId: string, index = 0): HTMLElement {
  const found = target.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)[index];
  if (found === undefined) {
    throw new Error(`the card has no ${testId}`);
  }
  return found;
}

function click(control: HTMLElement): void {
  flushSync(() => {
    control.click();
  });
}

/** `count` numbered lines, the shape most of these tools return. */
function lines(count: number, prefix = "line"): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${String(index + 1)}`).join("\n");
}

describe("tool call cards", () => {
  it("shows a running tool call as a row", () => {
    const target = render(toolCallEntry("entry-1", "running"));

    const row = card(target);
    expect(row.getAttribute("data-tool-status")).toBe("running");
    expect(part(target, "tool-card-name").textContent).toBe("bash");
    expect(part(target, "tool-card-input").textContent).toContain("ls");
    expect(part(target, "tool-card-status").textContent).toBe("Running");
  });

  it("shows a completed tool call with its output", () => {
    const target = render(toolCallEntry("entry-1", "success", "listing.txt"));

    expect(card(target).getAttribute("data-tool-status")).toBe("success");
    expect(part(target, "tool-card-output").textContent).toContain("listing.txt");
  });

  it("shows a failed tool call as an error", () => {
    const target = render(toolCallEntry("entry-1", "error", "exit 1"));

    expect(card(target).getAttribute("data-tool-status")).toBe("error");
    expect(part(target, "tool-card-status").textContent).toBe("Failed");
    expect(part(target, "tool-card-output").textContent).toContain("exit 1");
  });

  it("treats a powershell command exactly like a bash command", () => {
    const target = render(
      toolEntry("bash", "bash", "success", { command: "ls -la" }, "listing"),
      toolEntry("pwsh", "powershell", "success", { command: "ls -la" }, "listing"),
    );

    const [bash, powershell] = [card(target, 0), card(target, 1)];
    expect(powershell.className).toBe(bash.className);
    expect(part(target, "tool-card-input", 1).textContent).toContain("ls -la");
    expect(part(target, "tool-card-status", 1).textContent).toBe("Done");
  });
});

describe("a tool card's folded output", () => {
  it("shows a capped preview and says how much is folded", () => {
    const target = render(toolEntry("e1", "bash", "success", { command: "seq 40" }, lines(40)));

    const output = part(target, "tool-card-output");
    expect(output.textContent).toContain("line 6");
    expect(output.textContent).not.toContain("line 7");
    expect(part(target, "tool-card-output-fold").textContent).toContain("⤷ 34 more lines");

    click(part(target, "tool-card-output-fold"));

    expect(part(target, "tool-card-output").textContent).toContain("line 40");
    expect(part(target, "tool-card-output-fold").textContent).toBe("⤷ collapse");
  });

  it("counts a list tool's leftovers in its own noun", () => {
    const target = render(
      toolEntry("e1", "grep", "success", { pattern: "step" }, lines(10, "src/a.ts:1:match")),
    );

    expect(part(target, "tool-card-output-fold").textContent).toBe("⤷ 6 more matches");
  });

  it("bounds one enormous line so a minified file cannot fill the screen", () => {
    const target = render(
      toolEntry("e1", "read", "success", { path: "bundle.min.js" }, "x".repeat(5000)),
    );

    const text = part(target, "tool-card-output").textContent ?? "";
    expect(text.length).toBeLessThan(400);
    expect(text).toContain("…");
  });

  it("numbers a read preview from the line it asked for", () => {
    const target = render(
      toolEntry(
        "e1",
        "read",
        "success",
        { path: "a.ts", offset: 401, limit: 20 },
        lines(20, "code"),
      ),
    );

    expect(part(target, "tool-card-input").textContent).toContain("lines 401–420");
    expect(part(target, "tool-card-output").textContent).toContain("401");
    expect(part(target, "tool-card-output-fold").textContent).toBe("⤷ 14 more lines");
  });

  it("says (no output) for a finished call that returned none", () => {
    const target = render(
      toolEntry("e1", "find", "success", { pattern: "*.md" }),
      toolEntry("e2", "bash", "success", { command: "echo quiet", timeout: 60 }),
    );

    expect(part(target, "tool-card-empty").textContent).toBe("(no output)");
    expect(part(target, "tool-card-empty", 1).textContent).toBe("(no output)");
  });

  it("shows nothing but the prompt line while the call is still running", () => {
    const target = render(toolEntry("e1", "bash", "running", { command: "npm test" }, ""));

    expect(target.querySelector('[data-testid="tool-card-empty"]')).toBeNull();
    expect(part(target, "tool-card-status").textContent).toBe("Running");
  });

  it("keeps pi's truncation notice visible while the body is folded, then shows the spill path whole", () => {
    const spill = "/var/folders/9k/8f2a91b0c3d4e5f6/T/pi-output-1a2b3c4d.log";
    const output = `${lines(20)}\n\n[Showing lines 1-2000 of 8412. Full output: ${spill}]`;
    const target = render(toolEntry("e1", "bash", "success", { command: "cat big.log" }, output));

    const notice = part(target, "tool-card-notice");
    expect(notice.textContent).toContain("Showing lines 1-2000 of 8412");
    expect(notice.textContent).toContain("…");
    expect(notice.textContent).not.toContain(spill);
    // The notice is not part of the output body, so folding cannot hide it.
    expect(part(target, "tool-card-output").textContent).not.toContain("Showing lines");

    click(part(target, "tool-card-output-fold"));

    expect(part(target, "tool-card-notice").textContent).toContain(spill);
  });

  it("lifts the command's ending into the status instead of the body", () => {
    const target = render(
      toolEntry("e1", "bash", "error", { command: "run" }, "boom\n\nCommand exited with code 3"),
    );

    expect(part(target, "tool-card-status").textContent).toBe("Failed");
    expect(part(target, "tool-card-ending").textContent).toBe("· exit 3");
    expect(part(target, "tool-card-output").textContent).toBe("boom");
  });

  it("names an aborted command and a timed-out one", () => {
    const target = render(
      toolEntry("e1", "bash", "error", { command: "sleep 99" }, "…\n\nCommand aborted"),
      toolEntry(
        "e2",
        "bash",
        "error",
        { command: "sleep 99" },
        "…\n\nCommand timed out after 10 seconds",
      ),
    );

    expect(part(target, "tool-card-ending", 0).textContent).toBe("· aborted");
    expect(part(target, "tool-card-ending", 1).textContent).toBe("· timed out");
  });

  it("leaves a command's own bracketed line alone", () => {
    const target = render(toolEntry("e1", "bash", "success", { command: "echo [ok]" }, "[ok]"));

    expect(target.querySelector('[data-testid="tool-card-notice"]')).toBeNull();
    expect(part(target, "tool-card-output").textContent).toBe("[ok]");
  });
});

describe("a tool card's folded input", () => {
  it("summarises a write and shows three lines of its content", () => {
    const content = lines(140, "paragraph");
    const target = render(
      toolEntry(
        "e1",
        "write",
        "success",
        { path: "docs/guide.md", content },
        "Successfully wrote to docs/guide.md",
      ),
    );

    expect(part(target, "tool-card-input").textContent).toContain("docs/guide.md");
    expect(part(target, "tool-card-input").textContent).toContain("140 lines");
    expect(part(target, "tool-card-payload-label").textContent).toContain("content · 140 lines");
    expect(part(target, "tool-card-input-fold").textContent).toBe("⤷ 137 more lines");

    click(part(target, "tool-card-input-fold"));

    expect(part(target, "tool-card-input-fold").textContent).toBe("⤷ collapse");
    expect(target.textContent).toContain("paragraph 140");
  });

  it("shows an edit as a diff of its first pair", () => {
    const target = render(
      toolEntry(
        "e1",
        "edit",
        "success",
        {
          path: "a.ts",
          edits: [
            {
              oldText: "const a = 1;\nold one\nold two",
              newText: "const a = 2;\nnew one\nnew two",
            },
            { oldText: "b", newText: "c" },
          ],
        },
        "Successfully replaced 2 block(s) in a.ts.",
      ),
    );

    expect(part(target, "tool-card-input").textContent).toContain("2 edits");
    expect(part(target, "tool-card-diff").textContent).toContain("-const a = 1;");
    expect(part(target, "tool-card-diff").textContent).toContain("+const a = 2;");
    expect(part(target, "tool-card-input-fold").textContent).toContain("2 more lines");
    expect(part(target, "tool-card-input-fold").textContent).toContain("1 more edit");

    click(part(target, "tool-card-input-fold"));

    expect(part(target, "tool-card-diff").textContent).toContain("+c");
  });

  it("holds a subagent's prompt back until the fold opens", () => {
    const prompt = lines(9, "instruction");
    const target = render(
      toolEntry("e1", "Agent", "running", {
        description: "Audit the renderers",
        subagent_type: "Explore",
        prompt,
      }),
    );

    expect(part(target, "tool-card-input").textContent).toContain("subagent_type=Explore");
    expect(part(target, "tool-card-input").textContent).toContain("9 lines");
    expect(target.textContent).not.toContain("instruction 1");
    expect(part(target, "tool-card-input-fold").textContent).toBe("⤷ 9 more lines");

    click(part(target, "tool-card-input-fold"));

    expect(target.textContent).toContain("instruction 9");
  });

  it("renders a nested argument of an extension tool rather than dropping it", () => {
    const target = render(
      toolEntry(
        "e1",
        "mcp__docs__search",
        "success",
        {
          query: "tool cards",
          filters: { lang: "en", tags: ["a", "b"] },
        },
        "found it",
      ),
    );

    expect(part(target, "tool-card-input").textContent).toContain(
      'filters={"lang":"en","tags":["a","b"]}',
    );
  });
});

describe("reasoning blocks", () => {
  it("collapses reasoning by default and expands it on demand", () => {
    const target = render(reasoningEntry("entry-1", "Weighing the seams."));

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

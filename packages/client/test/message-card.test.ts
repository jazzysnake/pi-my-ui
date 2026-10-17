import { flushSync } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EntryKind,
  MessageRole,
  type BashExecutionBlock,
  type ContentBlock,
  type ProjectedEntry,
  type ProjectedMessageEntry,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { mountShell, snapshotOf } from "./composer-harness.js";

function message(
  id: string,
  role: ProjectedMessageEntry["role"],
  blocks: readonly ContentBlock[],
): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id,
    parentId: null,
    role,
    timestamp: 0,
    blocks,
  };
}

function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

function bash(command: string, output: string): BashExecutionBlock {
  return {
    type: "bashExecution",
    commandId: `${command}-id`,
    command,
    excludeFromContext: false,
    output,
  };
}

function notification(payload: string): ProjectedEntry {
  return message("notification", MessageRole.Notification, [text(payload)]);
}

function boundary(): ProjectedEntry {
  return {
    kind: EntryKind.CompactionBoundary,
    id: "boundary",
    parentId: null,
    timestamp: 0,
    summary: "The earlier turns became a summary.",
    tokensBefore: 1_200,
    firstKeptEntryId: "kept",
  };
}

function render(entries: readonly ProjectedEntry[]): HTMLElement {
  const store = new ClientStore();
  const { target } = mountShell(store);
  flushSync(() => {
    store.receive(snapshotOf(entries));
  });
  return target;
}

function row(target: HTMLElement, entryId: string): HTMLElement {
  const element = target.querySelector<HTMLElement>(
    `[data-testid="transcript-entry"][data-entry-id="${entryId}"]`,
  );
  if (element === null) {
    throw new Error(`the transcript has no row for ${entryId}`);
  }
  return element;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let an async click handler's clipboard promise settle, then paint the result. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe("a message as a card", () => {
  it("draws every message row inside a card, with the reader's surface raised", () => {
    const target = render([
      message("user", MessageRole.User, [text("my turn")]),
      message("assistant", MessageRole.Assistant, [text("the reply")]),
      message("tool-result", MessageRole.ToolResult, [text("an orphan tool result")]),
      message("bash", MessageRole.Bash, [bash("ls", "listing.txt")]),
    ]);

    const surfaces = ["user", "assistant", "tool-result", "bash"].map((entryId) => {
      const card = row(target, entryId).querySelector('[data-testid="message-card"]');
      expect(card, entryId).not.toBeNull();
      return card?.getAttribute("data-surface");
    });

    expect(surfaces).toEqual(["raised", "panel", "panel", "panel"]);
  });

  it("keeps notifications and compaction boundaries out of the message card", () => {
    const target = render([notification("<summary>Agent done</summary>"), boundary()]);

    expect(target.querySelector('[data-testid="notification-card"]')).not.toBeNull();
    expect(row(target, "notification").querySelector('[data-testid="copy-message"]')).toBeNull();
    expect(target.querySelector('[data-testid="compaction-boundary"]')).not.toBeNull();
    expect(row(target, "boundary").querySelector('[data-testid="copy-message"]')).toBeNull();
    expect(target.querySelector('[data-testid="message-card"]')).toBeNull();
  });
});

describe("the message card's copy control", () => {
  it("shows one control only when the message has copyable text", () => {
    const target = render([
      message("text", MessageRole.Assistant, [text("copy me")]),
      message("thinking", MessageRole.Assistant, [{ type: "reasoning", text: "weighing it" }]),
      message("tool", MessageRole.Assistant, [
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "ls" },
          status: "success",
        },
      ]),
      message("empty", MessageRole.Assistant, []),
    ]);

    for (const entryId of ["text", "thinking", "tool", "empty"]) {
      const controls = row(target, entryId).querySelectorAll('[data-testid="copy-message"]');
      expect(controls, entryId).toHaveLength(entryId === "text" ? 1 : 0);
    }
  });

  it("writes the message's clipboard text, including a bash command and its output", () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const target = render([
      message("user", MessageRole.User, [text("copy this turn")]),
      message("bash", MessageRole.Bash, [bash("ls", "listing.txt")]),
    ]);

    for (const entryId of ["user", "bash"]) {
      const control = row(target, entryId).querySelector<HTMLButtonElement>(
        '[data-testid="copy-message"]',
      );
      if (control === null) {
        throw new Error(`${entryId} has no copy control`);
      }
      flushSync(() => {
        control.click();
      });
    }

    expect(writeText).toHaveBeenNthCalledWith(1, "copy this turn");
    expect(writeText).toHaveBeenNthCalledWith(2, "$ ls\nlisting.txt");
  });

  it("confirms with a success check for 1.4 s, then reverts, keeping its name", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const target = render([message("assistant", MessageRole.Assistant, [text("copy me")])]);
    const control = row(target, "assistant").querySelector<HTMLButtonElement>(
      '[data-testid="copy-message"]',
    );
    const announcement = target.querySelector('[data-testid="copy-announcement"]');
    if (control === null || announcement === null) {
      throw new Error("the message card has no copy control or live region");
    }

    expect(control.getAttribute("aria-label")).toBe("Copy message");
    expect(control.getAttribute("data-copied")).toBe("false");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("copy");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.textContent).toBe("");

    flushSync(() => {
      control.click();
    });
    await settle();

    expect(control.getAttribute("aria-label")).toBe("Copy message");
    expect(control.getAttribute("data-copied")).toBe("true");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("check");
    expect(control.className).toContain("text-success");
    expect(announcement.textContent).toBe("Copied");

    vi.advanceTimersByTime(1_399);
    flushSync();
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("check");

    vi.advanceTimersByTime(1);
    flushSync();
    expect(control.getAttribute("aria-label")).toBe("Copy message");
    expect(control.getAttribute("data-copied")).toBe("false");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("copy");
    expect(announcement.textContent).toBe("");
  });

  it("leaves the glyph and the live region unchanged when the write is rejected", async () => {
    const writeText = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const target = render([message("assistant", MessageRole.Assistant, [text("copy me")])]);
    const control = row(target, "assistant").querySelector<HTMLButtonElement>(
      '[data-testid="copy-message"]',
    );
    const announcement = target.querySelector('[data-testid="copy-announcement"]');
    if (control === null || announcement === null) {
      throw new Error("the message card has no copy control or live region");
    }

    flushSync(() => {
      control.click();
    });
    await settle();

    expect(writeText).toHaveBeenCalledWith("copy me");
    expect(control.getAttribute("data-copied")).toBe("false");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("copy");
    expect(announcement.textContent).toBe("");
  });
});

describe("the thinking row and the copy column", () => {
  it("draws the first thinking row as its own collapsed box clear of the copy column", () => {
    const target = render([
      message("assistant", MessageRole.Assistant, [
        { type: "reasoning", text: "weighing it" },
        text("the answer"),
      ]),
    ]);

    const card = row(target, "assistant").querySelector('[data-testid="message-card"]');
    const firstBlock = row(target, "assistant").querySelector<HTMLElement>(
      '[data-testid="message-card-first-block"]',
    );
    if (card === null || firstBlock === null) {
      throw new Error("the card is missing its first block");
    }
    const thinking = firstBlock.querySelector<HTMLDetailsElement>(
      '[data-testid="reasoning-block"]',
    );
    if (thinking === null) {
      throw new Error("the card's first block is not a thinking row");
    }

    expect(card.querySelector('[data-testid="copy-message"]')).not.toBeNull();
    expect(getComputedStyle(firstBlock).paddingRight).toBe("44px");
    expect(firstBlock.contains(thinking)).toBe(true);
    expect(thinking.open).toBe(false);
    expect(thinking.textContent).toContain("Thinking");
    expect(thinking.querySelector("svg")?.dataset["icon"]).toBe("chevron-right");
    expect(thinking.querySelector('[data-testid="copy-message"]')).toBeNull();
  });

  it("gives a thinking-only message no control and the full card width", () => {
    const target = render([
      message("assistant", MessageRole.Assistant, [{ type: "reasoning", text: "weighing it" }]),
    ]);

    const card = row(target, "assistant").querySelector('[data-testid="message-card"]');
    const firstBlock = row(target, "assistant").querySelector<HTMLElement>(
      '[data-testid="message-card-first-block"]',
    );
    if (card === null || firstBlock === null) {
      throw new Error("the card is missing its first block");
    }

    expect(card.querySelector('[data-testid="copy-message"]')).toBeNull();
    expect(getComputedStyle(firstBlock).paddingRight).toBe("0px");
  });
});

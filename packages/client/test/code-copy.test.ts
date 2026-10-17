import { flushSync } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  type ContentBlock,
  type ProjectedEntry,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { deltaOf, mountShell, settle, snapshotOf } from "./composer-harness.js";

const TWO_BLOCKS = [
  "Run the suite first:",
  "",
  "```bash",
  "npm run verify",
  "```",
  "",
  "Then the pinned value:",
  "",
  "```ts",
  "const answer = 42;",
  "```",
].join("\n");

function assistant(text: string): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id: "assistant",
    parentId: null,
    role: MessageRole.Assistant,
    timestamp: 0,
    blocks: [{ type: "text", text } satisfies ContentBlock],
  };
}

function render(text: string): HTMLElement {
  const store = new ClientStore();
  const { target } = mountShell(store);
  flushSync(() => {
    store.receive(snapshotOf([assistant(text)]));
  });
  return target;
}

function blocks(target: HTMLElement): readonly HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>('[data-testid="code-block"]')];
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a fenced code block's copy control", () => {
  it("gives every fenced block one control named Copy code, in a strip clear of the scrolling code", () => {
    const target = render(TWO_BLOCKS);
    const rendered = blocks(target);
    expect(rendered).toHaveLength(2);

    for (const block of rendered) {
      const controls = block.querySelectorAll<HTMLButtonElement>('[data-testid="copy-code"]');
      expect(controls).toHaveLength(1);
      expect(controls[0]?.getAttribute("aria-label")).toBe("Copy code");

      const strip = block.querySelector<HTMLElement>('[data-testid="code-copy-strip"]');
      const pre = block.querySelector<HTMLPreElement>("pre");
      if (strip === null || pre === null) {
        throw new Error("a code block is missing its strip or its pre");
      }
      // The strip is the pre's sibling, not something inside the box that scrolls sideways, so
      // wide code can never slide under the control.
      expect(strip.parentElement).toBe(block);
      expect(pre.parentElement).toBe(block);
      expect(strip.contains(pre)).toBe(false);
      expect(pre.contains(strip)).toBe(false);
      expect(pre.querySelector('[data-testid="copy-code"]')).toBeNull();
      expect(strip.querySelector('[data-testid="copy-code"]')).toBe(controls[0]);
    }
  });

  it("writes exactly the code, with no fences and no language label", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const target = render(TWO_BLOCKS);
    const [first, second] = blocks(target);
    if (first === undefined || second === undefined) {
      throw new Error("the transcript did not render both code blocks");
    }

    for (const block of [first, second]) {
      const control = block.querySelector<HTMLButtonElement>('[data-testid="copy-code"]');
      if (control === null) {
        throw new Error("a code block has no copy control");
      }
      flushSync(() => {
        control.click();
      });
      await settle();
    }

    expect(writeText).toHaveBeenNthCalledWith(1, "npm run verify");
    expect(writeText).toHaveBeenNthCalledWith(2, "const answer = 42;");
  });

  it("leaves the message card's control copying the whole message, code included", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const target = render(TWO_BLOCKS);
    const control = target.querySelector<HTMLButtonElement>('[data-testid="copy-message"]');
    if (control === null) {
      throw new Error("the message card has no copy control");
    }
    expect(control.getAttribute("aria-label")).toBe("Copy message");
    flushSync(() => {
      control.click();
    });
    await settle();

    expect(writeText).toHaveBeenCalledWith(TWO_BLOCKS);
  });

  it("confirms with the same 1.4 s check, keeping its name, then reverts", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const target = render(TWO_BLOCKS);
    const [first] = blocks(target);
    if (first === undefined) {
      throw new Error("the transcript did not render a code block");
    }
    const control = first.querySelector<HTMLButtonElement>('[data-testid="copy-code"]');
    const announcement = first.querySelector('[data-testid="copy-announcement"]');
    if (control === null || announcement === null) {
      throw new Error("the code block has no copy control or live region");
    }

    expect(control.getAttribute("data-copied")).toBe("false");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("copy");

    flushSync(() => {
      control.click();
    });
    await settle();

    expect(control.getAttribute("aria-label")).toBe("Copy code");
    expect(control.getAttribute("data-copied")).toBe("true");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("check");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.textContent).toBe("Copied");

    vi.advanceTimersByTime(1_399);
    flushSync();
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("check");

    vi.advanceTimersByTime(1);
    flushSync();
    expect(control.getAttribute("aria-label")).toBe("Copy code");
    expect(control.getAttribute("data-copied")).toBe("false");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("copy");
    expect(announcement.textContent).toBe("");
  });

  it("leaves the glyph unchanged on a rejected write", async () => {
    const writeText = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const target = render(TWO_BLOCKS);
    const [first] = blocks(target);
    if (first === undefined) {
      throw new Error("the transcript did not render a code block");
    }
    const control = first.querySelector<HTMLButtonElement>('[data-testid="copy-code"]');
    const announcement = first.querySelector('[data-testid="copy-announcement"]');
    if (control === null || announcement === null) {
      throw new Error("the code block has no copy control or live region");
    }

    flushSync(() => {
      control.click();
    });
    await settle();

    expect(writeText).toHaveBeenCalledWith("npm run verify");
    expect(control.getAttribute("data-copied")).toBe("false");
    expect(control.querySelector("svg")?.dataset["icon"]).toBe("copy");
    expect(announcement.textContent).toBe("");
  });

  it("re-upgrades the blocks when a streaming update replaces the markup", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([assistant("```bash\nnpm ci\n```")]));
    });
    expect(blocks(target)).toHaveLength(1);

    flushSync(() => {
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.EntryUpsert,
              entry: assistant("```bash\nnpm ci\n```\n\n```bash\nnpm run verify\n```"),
            },
          ],
          1,
        ),
      );
    });

    const rendered = blocks(target);
    expect(rendered).toHaveLength(2);
    for (const block of rendered) {
      expect(block.querySelectorAll('[data-testid="copy-code"]')).toHaveLength(1);
    }

    const second = rendered[1];
    const control = second?.querySelector<HTMLButtonElement>('[data-testid="copy-code"]');
    if (control === null || control === undefined) {
      throw new Error("the re-rendered code block has no copy control");
    }
    flushSync(() => {
      control.click();
    });
    await settle();

    expect(writeText).toHaveBeenCalledWith("npm run verify");
  });
});

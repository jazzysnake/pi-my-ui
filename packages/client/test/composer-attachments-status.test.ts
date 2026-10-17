import { flushSync } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { mountShell, settingsOf, snapshotOf } from "./composer-harness.js";

describe("composer attachments", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  async function attach(target: HTMLElement, name = "tiny.png"): Promise<void> {
    const picker = target.querySelector<HTMLInputElement>('[data-testid="composer-attach-input"]');
    if (picker === null) {
      throw new Error("the attach input is missing");
    }
    const file = new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    // The base64 read is a FileReader callback, so let its microtask run.
    await vi.waitFor(() => {
      expect(target.querySelectorAll('[data-testid="attachment"]')).toHaveLength(1);
    });
  }

  it("shows a removable thumbnail for a picked image", async () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    await attach(target);

    expect(target.querySelector('[data-testid="attachment"] img')?.getAttribute("alt")).toBe(
      "tiny.png",
    );
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[aria-label="Remove tiny.png"]')?.click();
    });
    expect(target.querySelectorAll('[data-testid="attachment"]')).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("refuses a non-image file with an error line and no attachment", async () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    const picker = target.querySelector<HTMLInputElement>('[data-testid="composer-attach-input"]');
    const file = new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" });
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    flushSync(() => {
      picker?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(target.querySelector('[data-testid="composer-error"]')?.textContent).toContain(
        "notes.txt",
      );
    });
    expect(target.querySelectorAll('[data-testid="attachment"]')).toHaveLength(0);
  });

  it("sends the image bytes with the message", async () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    await attach(target);
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });
    expect(prompt).toHaveBeenCalledWith("", [{ mediaType: "image/png", data: "AQID" }], undefined);
  });
});

describe("the status strip", () => {
  it("shows pi's settings and toggles automatic compaction", () => {
    const store = new ClientStore();
    const { target, setAutoCompaction } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(settingsOf());
    });

    expect(target.querySelector('[data-testid="status-model"]')?.textContent).toBe(
      "Scripted model",
    );
    expect(target.querySelector('[data-testid="status-thinking"]')?.textContent).toBe("Low");
    const toggle = target.querySelector<HTMLButtonElement>(
      '[data-testid="auto-compaction-toggle"]',
    );
    expect(toggle?.getAttribute("data-auto-compaction")).toBe("true");

    flushSync(() => {
      toggle?.click();
    });
    expect(setAutoCompaction).toHaveBeenCalledWith(false);

    // The strip still shows pi's value until the server reports the change.
    expect(toggle?.getAttribute("data-auto-compaction")).toBe("true");
    flushSync(() => {
      store.receive(settingsOf({ autoCompactionEnabled: false }));
    });
    expect(toggle?.getAttribute("data-auto-compaction")).toBe("false");
  });

  it("offers only pi's models and thinking levels", () => {
    const store = new ClientStore();
    const { target, setModel, setThinking } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(settingsOf());
    });

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="model-picker-toggle"]')?.click();
    });
    const models = [...target.querySelectorAll('[data-testid="model-option"]')];
    expect(models.map((option) => option.textContent?.trim())).toEqual([
      "Scripted model",
      "Second model",
    ]);
    flushSync(() => {
      (models[1] as HTMLButtonElement | undefined)?.click();
    });
    expect(setModel).toHaveBeenCalledWith("scripted", "scripted-2");

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="thinking-picker-toggle"]')?.click();
    });
    const levels = [...target.querySelectorAll('[data-testid="thinking-option"]')];
    expect(levels.map((option) => option.getAttribute("data-thinking-level"))).toEqual([
      "off",
      "low",
      "high",
    ]);
    flushSync(() => {
      (levels[2] as HTMLButtonElement | undefined)?.click();
    });
    expect(setThinking).toHaveBeenCalledWith("high");
  });
});

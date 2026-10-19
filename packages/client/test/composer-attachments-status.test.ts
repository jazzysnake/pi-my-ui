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

/**
 * A tap as the browser delivers one: a press and a lift at the same place. jsdom does no hit testing, so
 * a test that dispatches this on an element is asserting the dismissal's own rules, not a scrim's.
 */
function tap(element: Element, x = 0, y = 0): void {
  const init = { bubbles: true, pointerId: 1, clientX: x, clientY: y };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  element.dispatchEvent(new PointerEvent("pointerup", init));
}

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

  it("dismisses an open model list on a tap away, leaves the model alone, and the toggle closes rather than reopens it", () => {
    const store = new ClientStore();
    const { target, setModel } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(settingsOf());
    });

    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="model-picker-toggle"]');
    const model = target.querySelector('[data-testid="status-model"]');
    const shown = model?.textContent;
    flushSync(() => {
      toggle?.click();
    });
    expect(target.querySelector('[data-testid="model-options"]')).not.toBeNull();

    // A tap on plain text has no click handler of its own, which is where a click-based dismissal
    // goes quiet on touch.
    const away = target.querySelector('[data-testid="transcript"]');
    if (away === null) {
      throw new Error("the transcript is missing");
    }
    flushSync(() => {
      tap(away);
    });
    expect(target.querySelector('[data-testid="model-options"]')).toBeNull();
    expect(model?.textContent).toBe(shown);
    expect(setModel).not.toHaveBeenCalled();

    // The control that opened the list is not "away": its own tap closes the list and its click
    // must not reopen it on the way back up.
    flushSync(() => {
      toggle?.click();
    });
    expect(target.querySelector('[data-testid="model-options"]')).not.toBeNull();
    flushSync(() => {
      if (toggle !== null) {
        tap(toggle);
      }
      toggle?.click();
    });
    expect(target.querySelector('[data-testid="model-options"]')).toBeNull();
  });

  it("dismisses an open effort list on a tap on the composer, keeps the level, and lets the tap reach the input", () => {
    const store = new ClientStore();
    const { target, setThinking } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(settingsOf());
    });

    const input = target.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    const thinking = target.querySelector('[data-testid="status-thinking"]');
    const shown = thinking?.textContent;
    if (input === null) {
      throw new Error("the composer input is missing");
    }
    let reached = false;
    input.addEventListener("pointerup", () => {
      reached = true;
    });

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="thinking-picker-toggle"]')?.click();
    });
    expect(target.querySelector('[data-testid="thinking-options"]')).not.toBeNull();

    flushSync(() => {
      tap(input);
    });
    expect(target.querySelector('[data-testid="thinking-options"]')).toBeNull();
    expect(thinking?.textContent).toBe(shown);
    expect(setThinking).not.toHaveBeenCalled();
    // The dismissal did not swallow the gesture: the input saw the same lift that closed the list,
    // and remains the control the next keystroke goes to.
    expect(reached).toBe(true);
    flushSync(() => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);
  });

  it("leaves an open list open when the pointer moves past the tap slop before it lifts", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(settingsOf());
    });

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="model-picker-toggle"]')?.click();
    });
    expect(target.querySelector('[data-testid="model-options"]')).not.toBeNull();

    // A scroll or drag begins outside the list with a press and travels before it lifts; only the
    // distance tells it apart from a tap, which is why the dismissal waits for the lift.
    const away = target.querySelector('[data-testid="transcript"]');
    if (away === null) {
      throw new Error("the transcript is missing");
    }
    flushSync(() => {
      away.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientX: 0, clientY: 0 }),
      );
      away.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 2, clientX: 24, clientY: 0 }),
      );
    });
    expect(target.querySelector('[data-testid="model-options"]')).not.toBeNull();
  });

  it("opening one picker closes the other, and a chosen row closes its list and applies once", () => {
    const store = new ClientStore();
    const { target, setThinking } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(settingsOf());
    });

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="model-picker-toggle"]')?.click();
    });
    expect(target.querySelector('[data-testid="model-options"]')).not.toBeNull();

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="thinking-picker-toggle"]')?.click();
    });
    expect(target.querySelector('[data-testid="model-options"]')).toBeNull();
    expect(target.querySelector('[data-testid="thinking-options"]')).not.toBeNull();

    const row = target.querySelector<HTMLButtonElement>(
      '[data-testid="thinking-option"][data-thinking-level="high"]',
    );
    flushSync(() => {
      row?.click();
    });
    expect(target.querySelector('[data-testid="thinking-options"]')).toBeNull();
    expect(setThinking).toHaveBeenCalledTimes(1);
    expect(setThinking).toHaveBeenCalledWith("high");
  });
});

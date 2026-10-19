import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { mountShell, snapshotOf } from "./composer-harness.js";

/**
 * The header's end group: the connection status leads and Files closes the row, because Files is the
 * control the header's trailing padding has to keep clear of the right safe area.
 */
describe("the header's end group", () => {
  it("puts the connection status before the Files toggle, with Files last", () => {
    const { target } = mountShell(new ClientStore());
    const bar = target.querySelector('[data-testid="top-bar"]');
    const status = bar?.querySelector('[data-testid="connection-status"]');
    const files = bar?.querySelector('[data-testid="files-toggle"]');
    if (bar === null || status == null || files == null) {
      throw new Error("the header is missing its connection status or its Files toggle");
    }

    expect(
      status.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the connection status must come before the Files toggle",
    ).toBeTruthy();

    const controls = [...bar.querySelectorAll('button, [data-testid="connection-status"]')];
    expect(controls.at(-1), "Files must be the header's last control").toBe(files);
  });

  it("hides the connection label at opacity 0 until the status control takes the tap", () => {
    const { target } = mountShell(new ClientStore());
    const status = target.querySelector<HTMLElement>('[data-testid="connection-status"]');
    const label = target.querySelector<HTMLElement>('[data-testid="connection-status-label"]');
    if (status === null || label === null) {
      throw new Error("the header is missing its connection status or its label");
    }

    expect(label.textContent).toBe("Connected");
    // jsdom has no cascade, so the reveal's two halves are asserted where they live: the label's own
    // opacity is 0, and only the wrapper's focus-within rule raises it. A tap focuses the wrapper
    // because it is in the tab order, which is what makes the label readable without hover.
    expect(label.classList.contains("opacity-0")).toBe(true);
    expect(label.classList.contains("group-focus-within:opacity-100")).toBe(true);
    expect(status.classList.contains("group")).toBe(true);
    expect(status.tabIndex).toBe(0);
    expect(status.matches(":focus-within")).toBe(false);

    status.focus();
    expect(document.activeElement).toBe(status);
    expect(status.matches(":focus-within")).toBe(true);
  });

  it("holds navigation controls only while a subagent runs", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    const snapshot = snapshotOf([]);
    flushSync(() => {
      store.receive({
        ...snapshot,
        projection: {
          ...snapshot.projection,
          runState: { kind: "streaming" },
          subagents: [
            {
              id: "a1",
              handle: "explore",
              type: "general-purpose",
              status: "running",
              runKind: "agent",
            },
          ],
        },
      });
    });

    const bar = target.querySelector('[data-testid="top-bar"]');
    if (bar === null) {
      throw new Error("the shell has no header");
    }

    // The pill is session state, so it belongs to the session bar; the header keeps only the controls
    // a thumb reaches for and nothing that changes with the run.
    expect(bar.querySelector('[data-testid="agent-pill"]')).toBeNull();
    expect([...bar.querySelectorAll("button")].map((control) => control.dataset["testid"])).toEqual(
      ["sessions-toggle", "files-toggle"],
    );

    // The run is announced by the composer's stop control and the transcript's growth, so the
    // session bar carries no second marker for it.
    expect(target.querySelector('[data-testid="run-activity"]')).toBeNull();
  });
});

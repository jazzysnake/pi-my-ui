import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  MessageRole,
  ServerMessageType,
  type ProjectedEntry,
  type SessionTree,
  type TreeNode,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { SESSION_ID, deltaOf, mountShell, snapshotOf, streaming } from "./composer-harness.js";

/**
 * The icon set is the client's one drawing for a control, so its contract is checked on the rendered
 * DOM: every control the previous UI drew as a glyph holds one, and none of them falls back to a
 * word. The pack's shared attributes are asserted once here so a hand-written `<svg>` cannot sneak
 * back in with a different grid or stroke.
 */

const ENTRY: readonly ProjectedEntry[] = [
  {
    kind: EntryKind.Message,
    id: "u1",
    parentId: null,
    role: MessageRole.User,
    timestamp: 0,
    blocks: [{ type: "text", text: "One message" }],
  },
];

function node(
  id: string,
  role: TreeNode["entry"]["role"],
  entryType = role === null ? "model_change" : "message",
): TreeNode {
  return { entry: { id, parentId: null, role, entryType, text: id }, children: [] };
}

const TREE: SessionTree = {
  leafId: "bash",
  roots: [
    node("user", MessageRole.User),
    node("assistant", MessageRole.Assistant),
    node("tool", MessageRole.ToolResult),
    node("bash", MessageRole.Bash),
    node("notification", MessageRole.Notification),
    node("model", null),
  ],
};

function iconOf(element: Element | null | undefined): SVGSVGElement | null {
  return element?.querySelector<SVGSVGElement>("svg") ?? null;
}

function byTestId(target: HTMLElement, testId: string): HTMLElement | null {
  return target.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function mountWithSession(): ReturnType<typeof mountShell> {
  const store = new ClientStore();
  const mounted = mountShell(store);
  flushSync(() => {
    store.receive(snapshotOf(ENTRY));
  });
  return mounted;
}

describe("the composer's controls", () => {
  it("draws an icon and no word for attach, branch and send", () => {
    const { target } = mountWithSession();

    const expected = {
      "composer-attach": "paperclip",
      "composer-branch": "git-branch",
      "composer-send": "arrow-up",
    } as const;
    for (const [testId, icon] of Object.entries(expected)) {
      const button = byTestId(target, testId);
      expect(iconOf(button)?.dataset["icon"], testId).toBe(icon);
      expect(button?.textContent?.trim(), testId).toBe("");
    }
  });

  it("draws a stop square and an icon-only send while a run is active", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRY));
      store.receive(deltaOf(streaming(), 1));
    });

    const stop = byTestId(target, "composer-send");
    expect(iconOf(stop)?.dataset["icon"]).toBe("square");
    expect(stop?.textContent?.trim()).toBe("");

    const send = byTestId(target, "composer-send-while-running");
    expect(iconOf(send)?.dataset["icon"]).toBe("arrow-up");
    expect(send?.textContent?.trim()).toBe("");
  });
});

describe("the header and the agent pill", () => {
  it("draws the menu and folder icons on the header's controls", () => {
    const { target } = mountWithSession();
    expect(iconOf(byTestId(target, "sessions-toggle"))?.dataset["icon"]).toBe("menu");
    expect(iconOf(byTestId(target, "files-toggle"))?.dataset["icon"]).toBe("folder");
  });

  it("leads the agent pill with the diamond", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    const snapshot = snapshotOf(ENTRY);
    flushSync(() => {
      store.receive({
        ...snapshot,
        projection: {
          ...snapshot.projection,
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

    const pill = byTestId(target, "agent-pill");
    expect(iconOf(pill)?.dataset["icon"]).toBe("diamond");
    expect(byTestId(target, "agent-pill-label")?.textContent).toBe("main +1");
  });
});

describe("the message tree's rows", () => {
  it("leads every row with the glyph for its kind", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRY));
    });
    flushSync(() => {
      byTestId(target, "composer-branch")?.click();
    });
    flushSync(() => {
      store.receive({ type: ServerMessageType.SessionTree, sessionId: SESSION_ID, tree: TREE });
    });

    const expected = {
      user: "user",
      assistant: "bot",
      tool: "hammer",
      bash: "terminal",
      notification: "pencil",
      model: "dot",
    } as const;
    for (const [entryId, icon] of Object.entries(expected)) {
      const select = target.querySelector<HTMLElement>(
        `[data-testid="message-tree-row"][data-entry-id="${entryId}"] [data-testid="message-tree-select"]`,
      );
      expect(iconOf(select)?.dataset["icon"], entryId).toBe(icon);
    }
  });

  it("carries the fork control on a user row, and only there", () => {
    const store = new ClientStore();
    const { target, fork } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRY));
    });
    flushSync(() => {
      byTestId(target, "composer-branch")?.click();
    });
    flushSync(() => {
      store.receive({ type: ServerMessageType.SessionTree, sessionId: SESSION_ID, tree: TREE });
    });

    const forkOf = (entryId: string) =>
      target.querySelector<HTMLElement>(
        `[data-testid="message-tree-row"][data-entry-id="${entryId}"] [data-testid="message-tree-fork"]`,
      );

    expect(forkOf("user")).not.toBeNull();
    expect(iconOf(forkOf("user"))?.dataset["icon"]).toBe("git-fork");
    expect(forkOf("assistant")).toBeNull();
    expect(forkOf("tool")).toBeNull();

    flushSync(() => {
      forkOf("user")?.click();
    });
    expect(fork).toHaveBeenCalledWith("user");
  });

  it("draws a chevron for a branch control and an x to close", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRY));
    });
    flushSync(() => {
      byTestId(target, "composer-branch")?.click();
    });
    flushSync(() => {
      store.receive({
        type: ServerMessageType.SessionTree,
        sessionId: SESSION_ID,
        tree: {
          // The branch point is off the active path, so it starts collapsed and the chevron it draws
          // is the one that says "tap to open".
          leafId: "leaf",
          roots: [
            {
              ...node("user", MessageRole.User),
              children: [node("a1", MessageRole.Assistant), node("a2", MessageRole.Assistant)],
            },
            node("leaf", MessageRole.Assistant),
          ],
        },
      });
    });

    const toggle = byTestId(target, "message-tree-toggle");
    expect(iconOf(toggle)?.dataset["icon"]).toBe("chevron-right");
    expect(iconOf(byTestId(target, "message-tree-close"))?.dataset["icon"]).toBe("x");

    flushSync(() => {
      toggle?.click();
    });
    expect(iconOf(byTestId(target, "message-tree-toggle"))?.dataset["icon"]).toBe("chevron-down");
  });
});

describe("the one renderer", () => {
  it("draws every icon on the pack's grid, stroke and size", () => {
    const { target } = mountWithSession();
    const icons = [...target.querySelectorAll<SVGSVGElement>("svg")];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(icon.getAttribute("fill")).toBe("none");
      expect(icon.getAttribute("stroke")).toBe("currentColor");
      expect(icon.getAttribute("stroke-width")).toBe("2");
      expect(icon.getAttribute("stroke-linecap")).toBe("round");
      expect(icon.getAttribute("stroke-linejoin")).toBe("round");
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      // The box is a token or a Tailwind size, never an inline width that would drift per caller.
      expect(icon.getAttribute("class")).toMatch(/(size-|size-\[)/);
    }
  });
});

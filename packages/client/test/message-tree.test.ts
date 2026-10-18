import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  MessageRole,
  ServerMessageType,
  type LeafMovedMessage,
  type ProjectedEntry,
  type SessionTree,
  type SessionTreeMessage,
  type TreeNode,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { SESSION_ID, input, mountShell, snapshotOf, type } from "./composer-harness.js";

/**
 * A tree shaped like a real branched Session: the active path runs through the second of two roots'
 * branches, one branch off the active path is abandoned, and one abandoned sibling hides two
 * alternatives — so "collapsed by default" and "counted" both have something to collapse.
 */
function node(
  id: string,
  role: TreeNode["entry"]["role"],
  text: string,
  children: readonly TreeNode[] = [],
): TreeNode {
  return {
    entry: {
      id,
      parentId: null,
      role,
      entryType: role === null ? "model_change" : "message",
      text,
    },
    children,
  };
}

const TREE: SessionTree = {
  leafId: "u6",
  roots: [
    {
      entry: {
        id: "s1",
        parentId: null,
        role: null,
        entryType: "system",
        text: "Seed system prompt",
      },
      children: [
        node("u1", MessageRole.User, "Abandoned approach: render every branch", [
          node("a1", MessageRole.Assistant, "Abandoned reply", [
            node("a2", MessageRole.Assistant, "Abandoned follow-up"),
          ]),
        ]),
        node("u4", MessageRole.User, "Kept approach: collapse branches", [
          node("a4", MessageRole.Assistant, "Kept reply", [
            node("u6", MessageRole.User, "Second message on the kept branch"),
          ]),
          node("t1", MessageRole.Assistant, "Abandoned sibling reply", [
            node("t2", MessageRole.Assistant, "Off-path alternative A"),
            node("t3", MessageRole.Assistant, "Off-path alternative B"),
          ]),
        ]),
      ],
    },
  ],
};

/**
 * The tree the owner is looking at after moving the Leaf back: a short new branch is the active path,
 * and the run of messages they left hangs off the new Leaf with nothing to choose inside it.
 */
const MOVED_BACK_TREE: SessionTree = {
  leafId: "n2",
  roots: [
    node("r1", null, "Seed system prompt", [
      node("u1", MessageRole.User, "First message", [
        node("a1", MessageRole.Assistant, "First reply", [
          node("u2", MessageRole.User, "Follow-up question", [
            node("a2", MessageRole.Assistant, "Answer to the follow-up"),
          ]),
        ]),
      ]),
      node("n1", MessageRole.User, "Edited first message", [
        node("n2", MessageRole.Assistant, "Reply to the edit"),
      ]),
    ]),
  ],
};

/** The same move, except the run that was left ends at a fork: an alternative, not a continuation. */
const FORKED_RUN_TREE: SessionTree = {
  leafId: "n2",
  roots: [
    node("r1", null, "Seed system prompt", [
      node("u1", MessageRole.User, "First message", [
        node("a1", MessageRole.Assistant, "First reply", [
          node("f1", MessageRole.Assistant, "Answer, with a retry", [
            node("f2", MessageRole.Assistant, "The retry you kept"),
            node("f3", MessageRole.Assistant, "The retry you abandoned"),
          ]),
        ]),
      ]),
      node("n1", MessageRole.User, "Edited first message", [
        node("n2", MessageRole.Assistant, "Reply to the edit"),
      ]),
    ]),
  ],
};

/** A Session nobody branched: one continuation after another, so there is nothing to collapse. */
const LINEAR_TREE: SessionTree = {
  leafId: "m4",
  roots: [
    node("m1", MessageRole.User, "Linear first message", [
      node("m2", MessageRole.Assistant, "Linear first reply", [
        node("m3", MessageRole.User, "Linear second message", [
          node("m4", MessageRole.Assistant, "Linear second reply"),
        ]),
      ]),
    ]),
  ],
};

function treeOf(tree: SessionTree): SessionTreeMessage {
  return { type: ServerMessageType.SessionTree, sessionId: SESSION_ID, tree };
}

function leafMovedOf(entryId: string, leafId: string | null): LeafMovedMessage {
  return { type: ServerMessageType.LeafMoved, sessionId: SESSION_ID, entryId, leafId };
}

/** The transcript the tree's active path would produce, so the modal opens over a real Session. */
const ENTRIES: readonly ProjectedEntry[] = [
  {
    kind: EntryKind.Message,
    id: "u6",
    parentId: "a4",
    role: MessageRole.User,
    timestamp: 0,
    blocks: [{ type: "text", text: "Second message on the kept branch" }],
  },
];

function send(target: HTMLElement): void {
  target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
}

function row(target: HTMLElement, entryId: string): HTMLElement | null {
  return target.querySelector<HTMLElement>(
    `[data-testid="message-tree-row"][data-entry-id="${entryId}"]`,
  );
}

function rowIds(target: HTMLElement): string[] {
  return [...target.querySelectorAll<HTMLElement>('[data-testid="message-tree-row"]')].map(
    (element) => element.dataset["entryId"] ?? "",
  );
}

/** Mount the modal on a given tree, the way opening `/tree` over a live Session does. */
function openTree(target: HTMLElement, store: ClientStore, tree: SessionTree): void {
  flushSync(() => {
    store.receive(snapshotOf(ENTRIES));
  });
  flushSync(() => {
    target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
  });
  flushSync(() => {
    store.receive(treeOf(tree));
  });
}

function toggleOf(target: HTMLElement, entryId: string): HTMLElement | null {
  return (
    row(target, entryId)?.querySelector<HTMLElement>('[data-testid="message-tree-toggle"]') ?? null
  );
}

/** How many hidden rows a toggle tells the user it will reveal, read from its own label. */
function announcedRows(toggle: HTMLElement | null): number | null {
  const stated = /\d+/.exec(toggle?.getAttribute("aria-label") ?? "");
  return stated === null ? null : Number(stated[0]);
}

describe("the message tree modal", () => {
  it("opens from /tree and from the branch control as the one modal", () => {
    const store = new ClientStore();
    const { target, getTree } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });

    flushSync(() => {
      type(target, "/tree");
    });
    flushSync(() => {
      send(target);
    });
    expect(getTree).toHaveBeenCalledTimes(1);
    const modal = target.querySelector('[data-testid="message-tree-modal"]');
    expect(modal?.getAttribute("role")).toBe("dialog");
    expect(modal?.getAttribute("aria-label")).toBe("Message tree");
    expect(input(target).value).toBe("");
    // The tree is the server's answer, so a modal with no answer says it is still loading.
    expect(target.querySelector('[data-testid="message-tree-loading"]')).not.toBeNull();

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="message-tree-close"]')?.click();
    });
    expect(target.querySelector('[data-testid="message-tree-modal"]')).toBeNull();

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    // The branch control is the other entrance to the same dialog, not a second picker.
    expect(getTree).toHaveBeenCalledTimes(2);
    const reopened = target.querySelector('[data-testid="message-tree-modal"]');
    expect(reopened?.getAttribute("role")).toBe("dialog");
    expect(reopened?.getAttribute("aria-label")).toBe("Message tree");
    expect(target.querySelector('[data-testid="message-tree-search"]')).not.toBeNull();
  });

  it("stays open when the Session's first Snapshot lands after it was opened", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);

    // A Session can be opened before its Snapshot arrives, so the first Projection must not read as
    // a switch to another Session and close the tree under the user's finger.
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    expect(target.querySelector('[data-testid="message-tree-modal"]')).not.toBeNull();

    flushSync(() => {
      store.receive(treeOf(TREE));
    });
    expect(rowIds(target)).toContain("u6");
  });

  it("expands the active path only, counting what each alternative hides", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(treeOf(TREE));
    });

    // The active path to the leaf, plus the abandoned sibling as a collapsed row.
    expect(rowIds(target)).toEqual(["s1", "u1", "u4", "a4", "u6", "t1"]);
    expect(row(target, "u6")?.dataset["leaf"]).toBe("true");
    expect(row(target, "u4")?.dataset["active"]).toBe("true");
    expect(row(target, "u1")?.dataset["active"]).toBe("false");
    expect(target.querySelector('[data-testid="message-tree-current"]')).not.toBeNull();

    // The alternative is collapsed and says how many entries it hides.
    const toggle = row(target, "t1")?.querySelector<HTMLButtonElement>(
      '[data-testid="message-tree-toggle"]',
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.textContent).toContain("2");

    flushSync(() => {
      toggle?.click();
    });
    expect(row(target, "t2")).not.toBeNull();
    expect(row(target, "t3")).not.toBeNull();
    expect(
      row(target, "t1")?.querySelector('[data-testid="message-tree-toggle"]')?.textContent,
    ).not.toContain("2");

    // The abandoned head is a continuation, not a branch point, but it lies off the active path so
    // its subtree is hidden by default and it needs a way in.
    expect(row(target, "u1")?.querySelector('[data-testid="message-tree-toggle"]')).not.toBeNull();
  });

  it("reveals an abandoned branch head whose only child is off the active path", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(treeOf(TREE));
    });

    // Collapsed by default: the abandoned branch is a row you can open, not one that opened itself.
    expect(row(target, "u1")).not.toBeNull();
    expect(row(target, "a1")).toBeNull();
    const reveal = row(target, "u1")?.querySelector<HTMLButtonElement>(
      '[data-testid="message-tree-toggle"]',
    );
    expect(reveal?.getAttribute("aria-expanded")).toBe("false");

    flushSync(() => {
      reveal?.click();
    });
    // One tap opens the whole run you left, through to the leaf you came from.
    expect(row(target, "a1")).not.toBeNull();
    expect(reveal?.getAttribute("aria-expanded")).toBe("true");
    expect(row(target, "a2")).not.toBeNull();

    // Tapping again closes the branch without destroying anything.
    flushSync(() => {
      reveal?.click();
    });
    expect(row(target, "a1")).toBeNull();
    expect(row(target, "a2")).toBeNull();
    expect(row(target, "u1")).not.toBeNull();
  });

  it("opens the branch you came from in one tap after moving the Leaf back", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    openTree(target, store, MOVED_BACK_TREE);

    // Before the tap the run you left is still collapsed: one row for its head, nothing more.
    expect(rowIds(target)).toEqual(["r1", "u1", "n1", "n2"]);
    const reveal = toggleOf(target, "u1");
    expect(reveal?.getAttribute("aria-expanded")).toBe("false");
    const announced = announcedRows(reveal);
    const shown = rowIds(target).length;
    expect(announced).toBe(3);

    flushSync(() => {
      reveal?.click();
    });

    // The whole run appears at once: tapping every message in between is the bug, not the design.
    expect(rowIds(target)).toEqual(["r1", "u1", "a1", "u2", "a2", "n1", "n2"]);
    expect(rowIds(target).length - shown).toBe(announced);
  });

  it("stops a run at the fork inside it, leaving the alternatives collapsed and counted", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    openTree(target, store, FORKED_RUN_TREE);

    const reveal = toggleOf(target, "u1");
    const announced = announcedRows(reveal);
    const shown = rowIds(target).length;

    flushSync(() => {
      reveal?.click();
    });

    // The run opens down to the fork, and the fork's alternatives are still something to open: one
    // tap on the head is not a licence to open every choice the run passed through.
    expect(rowIds(target)).toEqual(["r1", "u1", "a1", "f1", "n1", "n2"]);
    expect(rowIds(target).length - shown).toBe(announced);
    const fork = toggleOf(target, "f1");
    expect(fork?.getAttribute("aria-expanded")).toBe("false");
    expect(announcedRows(fork)).toBe(2);
  });

  it("gives a linear Session no toggles at all", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(treeOf(LINEAR_TREE));
    });

    // Every entry is a continuation of one path, so the whole Session is visible at once and no row
    // offers to open something that is already open.
    expect(rowIds(target)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(target.querySelectorAll('[data-testid="message-tree-toggle"]')).toHaveLength(0);
    for (const element of target.querySelectorAll<HTMLElement>(
      '[data-testid="message-tree-row"]',
    )) {
      expect(element.dataset["depth"]).toBe("0");
    }
  });

  it("searches, then expands and highlights the entry the user picks", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(treeOf(TREE));
    });

    // Collapsed entries are searchable: the query searches the whole tree, not the visible rows.
    const search = target.querySelector<HTMLInputElement>('[data-testid="message-tree-search"]');
    flushSync(() => {
      if (search !== null) {
        search.value = "off-path alternative B";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const matches = [...target.querySelectorAll<HTMLElement>('[data-testid="message-tree-match"]')];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.textContent).toContain("Off-path alternative B");

    flushSync(() => {
      matches[0]?.click();
    });
    expect(search?.value).toBe("");
    expect(row(target, "t3")).not.toBeNull();
    expect(row(target, "t3")?.dataset["highlighted"]).toBe("true");
    expect(row(target, "t2")).not.toBeNull();
  });

  it("moves the leaf for a non-user entry and closes only once the server confirms", () => {
    const store = new ClientStore();
    const { target, moveLeaf } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(treeOf(TREE));
    });

    flushSync(() => {
      row(target, "a4")
        ?.querySelector<HTMLButtonElement>('[data-testid="message-tree-select"]')
        ?.click();
    });
    expect(moveLeaf).toHaveBeenCalledWith("a4");
    // Nothing has moved yet, so the modal is still open on the tree it showed and the row says it is
    // waiting rather than reading as a switch that happened.
    expect(target.querySelector('[data-testid="message-tree-modal"]')).not.toBeNull();
    expect(row(target, "a4")?.querySelector('[data-testid="message-tree-moving"]')).not.toBeNull();

    flushSync(() => {
      store.receive(leafMovedOf("a4", "a4"));
    });
    expect(target.querySelector('[data-testid="message-tree-modal"]')).toBeNull();
    expect(input(target).value).toBe("");
  });

  it("returns one of my own messages to the composer when the move is confirmed", () => {
    const store = new ClientStore();
    const { target, moveLeaf } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(treeOf(TREE));
    });

    flushSync(() => {
      row(target, "u4")
        ?.querySelector<HTMLButtonElement>('[data-testid="message-tree-select"]')
        ?.click();
    });
    expect(moveLeaf).toHaveBeenCalledWith("u4");
    expect(input(target).value).toBe("");

    // A user message moves the leaf to its parent: that is what makes it editable and resubmittable.
    flushSync(() => {
      store.receive(leafMovedOf("u4", "s1"));
    });
    expect(input(target).value).toBe("Kept approach: collapse branches");
    expect(target.querySelector('[data-testid="message-tree-modal"]')).toBeNull();
  });

  it("shows a refused move and keeps the modal open", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive(treeOf(TREE));
    });

    flushSync(() => {
      row(target, "a4")
        ?.querySelector<HTMLButtonElement>('[data-testid="message-tree-select"]')
        ?.click();
    });
    flushSync(() => {
      store.receive({
        type: ServerMessageType.Error,
        session: { project: "/workspace", id: SESSION_ID },
        error: {
          code: "commandFailed",
          message: "pi left the active leaf at null; the move was refused",
          detail: "a4",
        },
      });
    });

    const alert = target.querySelector('[data-testid="message-tree-move-error"]');
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("the move was refused");
    expect(target.querySelector('[data-testid="message-tree-modal"]')).not.toBeNull();
    expect(input(target).value).toBe("");
  });

  it("says why the tree could not be read instead of showing an empty one", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(ENTRIES));
    });
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-branch"]')?.click();
    });
    flushSync(() => {
      store.receive({
        type: ServerMessageType.Error,
        session: { project: "/workspace", id: SESSION_ID },
        error: { code: "internalError", message: "pi could not read this Session's tree" },
      });
    });

    expect(target.querySelector('[data-testid="message-tree-error"]')?.textContent).toContain(
      "pi could not read this Session's tree",
    );
    expect(target.querySelector('[data-testid="message-tree-loading"]')).toBeNull();
  });
});

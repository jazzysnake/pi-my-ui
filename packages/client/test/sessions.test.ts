import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it, vi, type Mock } from "vitest";

import {
  ProjectionDeltaKind,
  ServerMessageType,
  SessionActivity,
  type ProjectedEntry,
  type ServerMessage,
  type SessionSummary,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

const IDLE = "idle" as const;

function summaryOf(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    name: null,
    firstMessage: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

function sessionsMessage(
  sessions: readonly SessionSummary[],
  activity: Readonly<Record<string, SessionActivity>> = {},
): ServerMessage {
  return { type: ServerMessageType.Sessions, sessions, activity };
}

function snapshotOf(sessionId: string, entries: readonly ProjectedEntry[]): ServerMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId,
    cursor: entries.length,
    projection: {
      sessionId,
      cwd: "/workspace",
      leafId: entries.at(-1)?.id ?? null,
      entries,
      runState: { kind: IDLE },
    },
  };
}

function deltaOf(sessionId: string, entry: ProjectedEntry): ServerMessage {
  return {
    type: ServerMessageType.Delta,
    sessionId,
    fromCursor: 0,
    cursor: 1,
    deltas: [{ kind: ProjectionDeltaKind.EntryUpsert, entry }],
  };
}

function entryOf(id: string, text: string): ProjectedEntry {
  return {
    id,
    parentId: null,
    role: "user",
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

interface Mounted {
  readonly target: HTMLElement;
  readonly select: Mock<(sessionId: string) => void>;
  readonly create: Mock<() => void>;
}

function mountShell(store: ClientStore): Mounted {
  const select = vi.fn<(sessionId: string) => void>((sessionId) => {
    store.selectSession(sessionId);
  });
  const create = vi.fn<() => void>();
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status: ConnectionStatus.Connected,
        onSelectSession: select,
        onPrompt: () => undefined,
        onAbort: () => undefined,
        onCreateSession: create,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: () => undefined,
      },
    });
  });
  return { target, select, create };
}

function openDrawer(target: HTMLElement): void {
  const toggle = target.querySelector<HTMLButtonElement>('[data-testid="sessions-toggle"]');
  if (toggle === null) {
    throw new Error("the sessions toggle is missing");
  }
  flushSync(() => {
    toggle.click();
  });
}

function rowNames(target: HTMLElement): (string | null | undefined)[] {
  return [...target.querySelectorAll('[data-testid="session-name"]')].map(
    (element) => element.textContent,
  );
}

describe("the session drawer over the store's ServerMessage input", () => {
  it("renders the server's sessions with the name, the first-message fallback and recency", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(
        sessionsMessage([
          summaryOf({
            id: "session-1",
            name: "Named session",
            firstMessage: "ignored when named",
            lastActivityAt: Date.now() - 5 * 60_000,
          }),
          summaryOf({
            id: "session-2",
            firstMessage: "Second session opening line",
            lastActivityAt: Date.now() - 3 * 24 * 60 * 60_000,
          }),
        ]),
      );
    });

    // Collapsed by default.
    expect(target.querySelector('[data-testid="session-drawer"]')).toBeNull();
    openDrawer(target);

    const rows = target.querySelectorAll('[data-testid="session-row"]');
    expect(rows).toHaveLength(2);
    expect(rowNames(target)).toEqual(["Named session", "Second session opening line"]);

    const times = [...target.querySelectorAll('[data-testid="session-time"]')].map(
      (element) => element.textContent,
    );
    expect(times).toEqual(["5m ago", "3d ago"]);
  });

  it("reports the tapped session and marks it current", () => {
    const store = new ClientStore();
    const { target, select } = mountShell(store);
    flushSync(() => {
      store.receive(
        sessionsMessage([
          summaryOf({ id: "session-1", name: "One" }),
          summaryOf({ id: "session-2", name: "Two" }),
        ]),
      );
    });
    openDrawer(target);

    const second = target.querySelectorAll<HTMLButtonElement>('[data-testid="session-row"]')[1];
    if (second === undefined) {
      throw new Error("the second session row is missing");
    }
    flushSync(() => {
      second.click();
    });

    expect(select).toHaveBeenCalledWith("session-2");
    expect(second.getAttribute("aria-current")).toBe("true");
    // The first row is no longer current.
    const first = target.querySelectorAll('[data-testid="session-row"]')[0];
    expect(first?.getAttribute("aria-current")).toBeNull();
  });

  it("drops the previous transcript on a switch and never applies its late Deltas", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf("session-1", [entryOf("a-1", "alpha transcript")]));
    });
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).toContain(
      "alpha transcript",
    );

    flushSync(() => {
      store.selectSession("session-2");
    });
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).not.toContain(
      "alpha transcript",
    );

    flushSync(() => {
      store.receive(snapshotOf("session-2", [entryOf("b-1", "beta transcript")]));
    });
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).toContain(
      "beta transcript",
    );

    // A Delta from the switched-away Session must not leak into the new transcript.
    flushSync(() => {
      store.receive(deltaOf("session-1", entryOf("a-2", "stale alpha line")));
    });
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).not.toContain(
      "stale alpha line",
    );
  });

  it("offers no rename or delete control", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(sessionsMessage([summaryOf({ id: "session-1", name: "One" })]));
    });
    openDrawer(target);

    const drawer = target.querySelector('[data-testid="session-drawer"]');
    if (drawer === null) {
      throw new Error("the drawer is missing");
    }
    expect(drawer.textContent).not.toMatch(/rename|delete/i);
    const labelled = [...drawer.querySelectorAll("[aria-label]")].map((element) =>
      element.getAttribute("aria-label"),
    );
    expect(labelled.some((label) => /rename|delete/i.test(label ?? ""))).toBe(false);
  });

  it("reports a create request from the plus control", () => {
    const store = new ClientStore();
    const { target, create } = mountShell(store);
    flushSync(() => {
      store.receive(sessionsMessage([]));
    });
    openDrawer(target);

    const plus = target.querySelector<HTMLButtonElement>('[data-testid="new-session-action"]');
    if (plus === null) {
      throw new Error("the new-session control is missing");
    }
    flushSync(() => {
      plus.click();
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("shows a working dot for a Session the server reports as working", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(
        sessionsMessage([summaryOf({ id: "session-1", name: "One", lastActivityAt: 100 })], {
          "session-1": SessionActivity.Working,
        }),
      );
    });
    openDrawer(target);

    const row = target.querySelector('[data-testid="session-row"]');
    expect(row?.getAttribute("data-activity")).toBe("working");
    expect(row?.querySelector('[data-testid="activity-dot"]')).not.toBeNull();
  });

  it("marks a background Session unread when output arrives and clears it on select", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(
        sessionsMessage([summaryOf({ id: "session-1", name: "One", lastActivityAt: 100 })]),
      );
    });
    openDrawer(target);
    const row = target.querySelector('[data-testid="session-row"]');
    expect(row?.querySelector('[data-testid="activity-dot"]')).toBeNull();

    // The Session produced output while the client was looking elsewhere.
    flushSync(() => {
      store.receive(
        sessionsMessage([summaryOf({ id: "session-1", name: "One", lastActivityAt: 200 })]),
      );
    });
    expect(row?.querySelector('[data-testid="activity-dot"]')).not.toBeNull();
    expect(
      row?.querySelector('[data-testid="activity-dot"]')?.getAttribute("data-activity-kind"),
    ).toBe("unread");

    // Viewing the Session advances its watermark, so the unread dot is gone.
    flushSync(() => {
      store.selectSession("session-1");
    });
    expect(row?.querySelector('[data-testid="activity-dot"]')).toBeNull();
  });

  it("never marks the Session being read unread", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(
        sessionsMessage([summaryOf({ id: "session-1", name: "One", lastActivityAt: 100 })]),
      );
    });
    flushSync(() => {
      store.selectSession("session-1");
    });
    openDrawer(target);

    flushSync(() => {
      store.receive(
        sessionsMessage([summaryOf({ id: "session-1", name: "One", lastActivityAt: 200 })]),
      );
    });
    const row = target.querySelector('[data-testid="session-row"]');
    expect(row?.querySelector('[data-testid="activity-dot"]')).toBeNull();
  });
});

import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import {
  ServerMessageType,
  SessionMutation,
  type ForkMessage,
  type ForkMessagesMessage,
  type SessionForkedMessage,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { SESSION_ID, input, mountShell, snapshotOf, type } from "./composer-harness.js";

const FORKABLE: readonly ForkMessage[] = [
  { entryId: "entry-first", text: "Seed text block 2." },
  { entryId: "entry-second", text: "Seed text block 20." },
];

function forkMessagesOf(messages: readonly ForkMessage[]): ForkMessagesMessage {
  return {
    type: ServerMessageType.ForkMessages,
    session: { project: "/workspace", id: SESSION_ID },
    messages,
  };
}

function forkedOf(mutation: SessionMutation, sessionId?: string): SessionForkedMessage {
  return {
    type: ServerMessageType.SessionForked,
    sourceSession: { project: "/workspace", id: SESSION_ID },
    mutation,
    ...(sessionId === undefined ? {} : { session: { project: "/workspace", id: sessionId } }),
  };
}

function send(target: HTMLElement): void {
  target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
}

function pickerRow(target: HTMLElement, entryId: string): HTMLButtonElement {
  const row = target.querySelector<HTMLButtonElement>(`[data-entry-id="${entryId}"]`);
  if (row === null) {
    throw new Error(`the fork picker row ${entryId} is missing`);
  }
  return row;
}

describe("fork", () => {
  it("offers pi's forkable messages and forks from the one chosen", () => {
    const store = new ClientStore();
    const { target, getForkMessages, fork } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/fork");
    });
    flushSync(() => {
      send(target);
    });
    expect(getForkMessages).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[data-testid="fork-picker"]')).not.toBeNull();
    // The list is pi's to send, so an answer that has not arrived is stated as waiting, never as an
    // empty list.
    expect(target.querySelector('[data-testid="fork-picker-loading"]')).not.toBeNull();
    expect(fork).not.toHaveBeenCalled();
    // The command is consumed by its picker, so it never reaches the model.
    expect(input(target).value).toBe("");

    flushSync(() => {
      store.receive(forkMessagesOf(FORKABLE));
    });
    expect(target.querySelector('[data-testid="fork-picker-loading"]')).toBeNull();
    expect(pickerRow(target, "entry-second").textContent).toContain("Seed text block 20.");

    flushSync(() => {
      pickerRow(target, "entry-second").click();
    });
    expect(fork).toHaveBeenCalledWith("entry-second");
    expect(target.querySelector('[data-testid="fork-picker"]')).toBeNull();
  });

  it("says so when there is no user message to fork from", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/fork");
    });
    flushSync(() => {
      send(target);
    });
    flushSync(() => {
      store.receive(forkMessagesOf([]));
    });

    expect(target.querySelector('[data-testid="fork-picker-empty"]')?.textContent).toContain(
      "no user messages",
    );
  });

  it("reports the new Session a fork made, and a veto as nothing performed", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      store.receive(forkedOf(SessionMutation.Fork, "session-forked"));
    });
    expect(target.querySelector('[data-testid="command-notice"]')?.textContent).toBe(
      "Fork created a new session, now open.",
    );

    flushSync(() => {
      store.receive(forkedOf(SessionMutation.Fork));
    });
    expect(target.querySelector('[data-testid="command-notice"]')?.textContent).toBe(
      "Fork was cancelled, so nothing was performed.",
    );
  });
});

describe("clone", () => {
  it("copies the active branch without asking for a fork message", () => {
    const store = new ClientStore();
    const { target, clone, getForkMessages } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/clone");
    });
    flushSync(() => {
      send(target);
    });

    expect(clone).toHaveBeenCalledTimes(1);
    expect(getForkMessages).not.toHaveBeenCalled();
    expect(target.querySelector('[data-testid="fork-picker"]')).toBeNull();
  });

  it("reports the new Session a clone made", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      store.receive(forkedOf(SessionMutation.Clone, "session-cloned"));
    });
    expect(target.querySelector('[data-testid="command-notice"]')?.textContent).toBe(
      "Clone created a new session, now open.",
    );
  });
});

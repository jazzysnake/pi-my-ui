import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it, vi } from "vitest";

import {
  ProjectionDeltaKind,
  RunStateKind,
  ServerMessageType,
  StreamingBehavior,
} from "@pi-my-ui/protocol";

import Composer from "../src/lib/Composer.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import {
  SESSION_ID,
  deltaOf,
  input,
  keydown,
  mountShell,
  snapshotOf,
  streaming,
  type,
  userEntry,
} from "./composer-harness.js";

describe("the composer's control row", () => {
  it("places attach and branch before send, with send the last control", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    const row = input(target).parentElement;
    if (row === null) {
      throw new Error("the control row is missing");
    }
    const ids = [...row.querySelectorAll("button")].map((button) =>
      button.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["composer-attach", "composer-branch", "composer-send"]);
  });

  it("turns send into stop while a run is active and shows the while-running row", () => {
    const store = new ClientStore();
    const { target, abort } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(deltaOf(streaming(), 0));
    });

    const send = target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]');
    expect(send?.textContent?.trim()).toBe("Stop");
    expect(target.querySelector('[role="group"][aria-label="While running"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="streaming-choice-hint"]')?.textContent).toContain(
      "Follow up: waits until this run finishes",
    );

    send?.click();
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

describe("sending from the composer", () => {
  it("sends the typed text", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    type(target, "hello agent");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });
    expect(prompt).toHaveBeenCalledWith("hello agent", [], undefined);
  });

  it("sends with the chosen streaming behavior while a run is active", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(deltaOf(streaming(), 0));
    });
    type(target, "change course");

    flushSync(() => {
      target
        .querySelector<HTMLButtonElement>('[data-testid="composer-send-while-running"]')
        ?.click();
    });
    expect(prompt).toHaveBeenLastCalledWith("change course", [], StreamingBehavior.Steer);

    // pi's echo of the steer clears the composer, so the next message starts from empty.
    flushSync(() => {
      store.receive(
        deltaOf(
          [{ kind: ProjectionDeltaKind.EntryUpsert, entry: userEntry("u-steer", "change course") }],
          1,
        ),
      );
    });
    type(target, "wait for this one");
    flushSync(() => {
      target
        .querySelector<HTMLButtonElement>('[data-testid="streaming-choice-follow-up"]')
        ?.click();
    });
    flushSync(() => {
      target
        .querySelector<HTMLButtonElement>('[data-testid="composer-send-while-running"]')
        ?.click();
    });
    expect(prompt).toHaveBeenLastCalledWith("wait for this one", [], StreamingBehavior.FollowUp);
  });

  it("sends on Ctrl+Enter and leaves plain Enter to insert a newline", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    type(target, "keyboard message");

    const plain = keydown(target, { key: "Enter" });
    expect(plain.defaultPrevented).toBe(false);
    expect(prompt).not.toHaveBeenCalled();

    flushSync(() => {
      keydown(target, { key: "Enter", ctrlKey: true });
    });
    expect(prompt).toHaveBeenCalledWith("keyboard message", [], undefined);
  });

  it("does not clear the text until pi echoes the message", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    type(target, "kept until accepted");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });
    expect(input(target).value).toBe("kept until accepted");

    flushSync(() => {
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.EntryUpsert,
              entry: userEntry("u1", "kept until accepted"),
            },
          ],
          0,
        ),
      );
    });
    expect(input(target).value).toBe("");
  });
});

describe("Escape in the composer", () => {
  it("gives the first Escape to an open palette and does not abort", () => {
    const onAbort = vi.fn();
    const target = document.createElement("div");
    document.body.append(target);
    flushSync(() => {
      mount(Composer as Component<Record<string, unknown>>, {
        target,
        props: {
          runState: { kind: RunStateKind.Streaming },
          status: ConnectionStatus.Connected,
          settings: null,
          error: null,
          sentCount: 0,
          onPrompt: () => undefined,
          onAbort,
          onSetModel: () => undefined,
          onSetThinkingLevel: () => undefined,
          onSetAutoCompaction: () => undefined,
          onBranch: () => undefined,
          onEscape: () => true,
        },
      });
    });
    const event = keydown(target, { key: "Escape" });
    expect(event.defaultPrevented).toBe(true);
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("cancels a running turn", () => {
    const store = new ClientStore();
    const { target, abort } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(deltaOf(streaming(), 0));
    });
    const event = keydown(target, { key: "Escape" });
    expect(event.defaultPrevented).toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no run is active", () => {
    const store = new ClientStore();
    const { target, abort } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    keydown(target, { key: "Escape" });
    expect(abort).not.toHaveBeenCalled();
  });
});

describe("a message pi refuses", () => {
  it("shows the error line, keeps the draft and marks the error role", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    type(target, "refused message");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
      store.receive({
        type: ServerMessageType.Error,
        error: { code: "internalError", message: "Agent is already processing" },
        sessionId: SESSION_ID,
      });
    });
    const error = target.querySelector('[data-testid="composer-error"]');
    expect(error?.textContent).toBe("Agent is already processing");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(input(target).value).toBe("refused message");
  });
});

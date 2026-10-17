import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import {
  ContentBlockType,
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  type BashExecutionBlock,
  type ProjectedEntry,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { deltaOf, input, mountShell, snapshotOf, type } from "./composer-harness.js";

function bashEntry(block: Partial<BashExecutionBlock> = {}): ProjectedEntry {
  return {
    id: "bash-entry-1",
    parentId: null,
    kind: EntryKind.Message,
    role: MessageRole.Bash,
    timestamp: 0,
    blocks: [
      {
        type: ContentBlockType.BashExecution,
        commandId: "cmd-1",
        command: "echo hello",
        excludeFromContext: false,
        output: "",
        ...block,
      },
    ],
  };
}

describe("the composer's bash mode indicator", () => {
  it("states that `!` output enters the context, before the command is sent", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "!echo hello");
    });

    const indicator = target.querySelector("[data-testid='bash-mode-indicator']");
    expect(indicator?.getAttribute("data-bash-mode")).toBe("include");
    expect(indicator?.textContent).toContain("adds to context");
    expect(indicator?.textContent).toContain(
      "The output will enter the model's context on the next prompt.",
    );
  });

  it("states that `!!` output stays out of the context, before the command is sent", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "!!echo secret");
    });

    const indicator = target.querySelector("[data-testid='bash-mode-indicator']");
    expect(indicator?.getAttribute("data-bash-mode")).toBe("exclude");
    expect(indicator?.textContent).toContain("not added to context");
    expect(indicator?.textContent).toContain("The output will not enter the model's context.");
  });

  it("disappears for text that is not a shell command", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "hello");
    });
    expect(target.querySelector("[data-testid='bash-mode-indicator']")).toBeNull();
  });
});

describe("sending a shell command", () => {
  it("sends `!` with the prefix stripped and the output included in context", () => {
    const store = new ClientStore();
    const { target, bash, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    type(target, "!echo hello");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });

    expect(bash).toHaveBeenCalledWith("echo hello", false);
    expect(prompt).not.toHaveBeenCalled();
    expect(input(target).value).toBe("");
  });

  it("sends `!!` with the output excluded from context", () => {
    const store = new ClientStore();
    const { target, bash } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    type(target, "!!echo secret");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });

    expect(bash).toHaveBeenCalledWith("echo secret", true);
  });

  it("refuses a bare prefix and sends nothing", () => {
    const store = new ClientStore();
    const { target, bash, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });
    type(target, "!!");
    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
    });

    expect(target.querySelector("[data-testid='composer-error']")?.textContent).toBe(
      "Enter a command after !!",
    );
    expect(bash).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(input(target).value).toBe("!!");
  });
});

describe("the bash card", () => {
  it("renders a finished command's output, exit code and mode", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(
        snapshotOf([
          bashEntry({
            output: "hello\n",
            result: { exitCode: 0, cancelled: false, truncated: false },
          }),
        ]),
      );
    });

    const card = target.querySelector("[data-testid='bash-card']");
    expect(card?.getAttribute("data-bash-status")).toBe("ok");
    expect(card?.getAttribute("data-bash-mode")).toBe("include");
    expect(target.querySelector("[data-testid='bash-command']")?.textContent).toBe("echo hello");
    expect(target.querySelector("[data-testid='bash-output']")?.textContent).toBe("hello\n");
    expect(target.querySelector("[data-testid='bash-exit']")?.textContent).toBe("Exit code 0");
    expect(target.querySelector("[data-testid='bash-mode-label']")?.textContent).toBe(
      "! adds to context",
    );
  });

  it("classifies a non-zero exit as an error and a cancelled command as aborted", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(
        snapshotOf([
          bashEntry({ result: { exitCode: 2, cancelled: false, truncated: false } }),
          {
            ...bashEntry({ result: { exitCode: null, cancelled: true, truncated: false } }),
            id: "bash-entry-2",
          },
        ]),
      );
    });

    const statuses = [...target.querySelectorAll("[data-testid='bash-card']")].map((card) =>
      card.getAttribute("data-bash-status"),
    );
    expect(statuses).toEqual(["error", "aborted"]);
  });

  it("keeps one card while the output streams in", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([bashEntry({ output: "hel" })]));
    });

    const first = target.querySelector("[data-testid='bash-card']");
    expect(first?.getAttribute("data-bash-status")).toBe("running");

    flushSync(() => {
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.EntryUpsert,
              entry: bashEntry({
                output: "hello\n",
                result: { exitCode: 0, cancelled: false, truncated: false },
              }),
            },
          ],
          1,
        ),
      );
    });

    const cards = target.querySelectorAll("[data-testid='bash-card']");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toBe(first);
    expect(cards[0]?.getAttribute("data-bash-status")).toBe("ok");
    expect(target.querySelector("[data-testid='bash-output']")?.textContent).toBe("hello\n");
  });
});

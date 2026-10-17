import { flushSync, tick } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  MessageRole,
  type ProjectedEntry,
  type ServerMessage,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { mountShell, snapshotOf } from "./composer-harness.js";
import recorded from "./fixtures/recorded-server-messages.json";

/**
 * Frames captured from a real hermetic run (`npm run capture:store-sequences`): real pi, the real
 * server and the scripted provider. The store tests replay them rather than inventing a sequence the
 * server would not send.
 */
const RECORDED_STREAMING = recorded.streaming as unknown as readonly ServerMessage[];
const RECORDED_RESYNC = recorded.resync as unknown as readonly ServerMessage[];
const RECORDED_REPLY: string = recorded.provenance.reply;

/**
 * The mounted window is a literal, not the component's own constant: reading the constant would let
 * a change to it pass this test by construction, and the bound is the whole claim.
 */
const WINDOW_SIZE = 60;

function longTranscript(count: number): ProjectedEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${String(index)}`,
    parentId: index === 0 ? null : `entry-${String(index - 1)}`,
    kind: EntryKind.Message,
    role: MessageRole.User,
    timestamp: index,
    blocks: [{ type: "text" as const, text: `Message ${String(index)}` }],
  }));
}

describe("bounded transcript window", () => {
  it("mounts only the newest window of a 500+ entry transcript and counts the rest", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(longTranscript(520)));
    });

    expect(target.querySelectorAll('[data-testid="transcript-entry"]')).toHaveLength(WINDOW_SIZE);
    expect(target.querySelector('[data-testid="hidden-older"]')?.textContent?.trim()).toBe(
      "Show 460 older messages",
    );
    expect(target.querySelector('[data-entry-id="entry-0"]')).toBeNull();
    expect(target.querySelector('[data-entry-id="entry-519"]')).not.toBeNull();
  });

  it("loads older entries in bounded pages and returns to the newest output", async () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(longTranscript(520)));
    });

    // The window grows to its ceiling and then slides, so older entries become reachable without
    // ever mounting the whole transcript.
    for (let step = 0; step < 4; step += 1) {
      flushSync(() => {
        target.querySelector<HTMLButtonElement>('[data-testid="hidden-older"]')?.click();
      });
      await tick();
    }
    expect(target.querySelectorAll('[data-testid="transcript-entry"]')).toHaveLength(240);
    expect(target.querySelector('[data-testid="hidden-newer"]')).not.toBeNull();

    for (let step = 0; step < 10; step += 1) {
      const older = target.querySelector<HTMLButtonElement>('[data-testid="hidden-older"]');
      if (older === null || target.querySelector('[data-entry-id="entry-0"]') !== null) {
        break;
      }
      flushSync(() => {
        older.click();
      });
      await tick();
    }
    expect(target.querySelector('[data-entry-id="entry-0"]')).not.toBeNull();
    expect(target.querySelectorAll('[data-testid="transcript-entry"]').length).toBeLessThanOrEqual(
      240,
    );

    flushSync(() => {
      target.querySelector<HTMLButtonElement>('[data-testid="hidden-newer"]')?.click();
    });
    await tick();
    expect(target.querySelector('[data-entry-id="entry-519"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="hidden-newer"]')).toBeNull();
    expect(target.querySelectorAll('[data-testid="transcript-entry"]')).toHaveLength(WINDOW_SIZE);
  });

  it("mounts every entry and no notice when the transcript fits the window", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf(longTranscript(12)));
    });

    expect(target.querySelectorAll('[data-testid="transcript-entry"]')).toHaveLength(12);
    expect(target.querySelector('[data-testid="hidden-older"]')).toBeNull();
  });
});

describe("streamed Deltas and row identity", () => {
  it("applies a captured real streaming run without remounting the rows", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    const first = RECORDED_STREAMING[0];
    if (first === undefined) {
      throw new Error("the captured stream has no Snapshot");
    }
    flushSync(() => {
      store.receive(first);
    });

    const before = new Map(
      [...target.querySelectorAll<HTMLElement>('[data-testid="transcript-entry"]')].map((row) => [
        row.dataset["entryId"] ?? "",
        row,
      ]),
    );
    expect(before.size).toBeGreaterThan(0);

    for (const message of RECORDED_STREAMING.slice(1)) {
      flushSync(() => {
        store.receive(message);
      });
    }

    // Every row the capture started with is still the same DOM node: the deltas grew one row in
    // place rather than replacing the transcript per frame.
    for (const [id, row] of before) {
      expect(target.querySelector(`[data-entry-id="${id}"]`)).toBe(row);
    }
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).toContain(
      RECORDED_REPLY,
    );
    const replyRows = [...target.querySelectorAll('[data-testid="transcript-entry"]')].filter(
      (row) => row.textContent?.includes(RECORDED_REPLY) === true,
    );
    expect(replyRows).toHaveLength(1);
  });

  it("replaces the streamed entries with the durable ids a resync Snapshot carries", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    for (const message of RECORDED_RESYNC) {
      flushSync(() => {
        store.receive(message);
      });
    }

    const final = RECORDED_RESYNC.at(-1);
    if (final === undefined || final.type !== "snapshot") {
      throw new Error("the captured resync does not end with a Snapshot");
    }
    const durableReply = final.projection.entries.find(
      (entry) =>
        entry.kind === EntryKind.Message &&
        entry.blocks.some((block) => block.type === "text" && block.text === RECORDED_REPLY),
    );
    expect(durableReply).toBeDefined();
    const replyRow = target.querySelector(`[data-entry-id="${durableReply?.id ?? ""}"]`);
    expect(replyRow).not.toBeNull();
    expect(replyRow?.textContent).toContain(RECORDED_REPLY);
    // The provisional id the streamed row was built with is gone, and the row was not duplicated.
    expect(target.querySelector('[data-entry-id^="pending:"]')).toBeNull();
    expect(
      [...target.querySelectorAll('[data-testid="transcript-entry"]')].filter(
        (row) => row.textContent?.includes(RECORDED_REPLY) === true,
      ),
    ).toHaveLength(1);
  });
});

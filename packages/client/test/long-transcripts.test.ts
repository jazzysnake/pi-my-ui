import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  type ProjectedEntry,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { deltaOf, mountShell, snapshotOf, userEntry } from "./composer-harness.js";

function assistantEntry(id: string, text: string): ProjectedEntry {
  return {
    id,
    parentId: "entry-1",
    kind: EntryKind.Message,
    role: MessageRole.Assistant,
    timestamp: 1,
    blocks: [{ type: "text", text }],
  };
}

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
    expect(target.querySelector('[data-testid="hidden-older"]')?.textContent).toBe(
      "460 older messages are not shown",
    );
    expect(target.querySelector('[data-entry-id="entry-0"]')).toBeNull();
    expect(target.querySelector('[data-entry-id="entry-519"]')).not.toBeNull();
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
  it("updates a streamed row in place instead of remounting the rows", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([userEntry("entry-1", "hello")]));
      store.receive(
        deltaOf(
          [{ kind: ProjectionDeltaKind.EntryUpsert, entry: assistantEntry("entry-2", "Hel") }],
          1,
        ),
      );
    });

    const userRow = target.querySelector('[data-entry-id="entry-1"]');
    const streamingRow = target.querySelector('[data-entry-id="entry-2"]');
    expect(userRow).not.toBeNull();
    expect(streamingRow).not.toBeNull();

    flushSync(() => {
      store.receive(
        deltaOf(
          [
            {
              kind: ProjectionDeltaKind.EntryUpsert,
              entry: assistantEntry("entry-2", "Hello there"),
            },
          ],
          2,
        ),
      );
    });

    // The same DOM nodes, so the text went into the existing row rather than a fresh one.
    expect(target.querySelector('[data-entry-id="entry-1"]')).toBe(userRow);
    expect(target.querySelector('[data-entry-id="entry-2"]')).toBe(streamingRow);
    expect(target.querySelector('[data-testid="transcript"]')?.textContent).toContain(
      "Hello there",
    );
  });
});

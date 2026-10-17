import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  ServerMessageType,
  type ProjectedEntry,
  type ServerMessage,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import ConnectionStatusIndicator from "../src/lib/ConnectionStatusIndicator.svelte";
import Shell from "../src/lib/Shell.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

/** A Snapshot as the server would send it, so the test exercises the store input, not a socket. */
function snapshotOf(entries: readonly ProjectedEntry[]): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: "session-1",
    cursor: entries.length,
    projection: {
      sessionId: "session-1",
      cwd: "/workspace",
      leafId: entries.at(-1)?.id ?? null,
      entries,
      runState: { kind: "idle" },
      subagents: [],
    },
  };
}

function userEntry(id: string, text: string): ProjectedEntry {
  return {
    id,
    parentId: null,
    role: "user",
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

function mountInto<Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
): HTMLElement {
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(component, { target, props });
  });
  return target;
}

describe("the shell over the store's ServerMessage input", () => {
  it("renders the transcript entries a Snapshot carries", () => {
    const store = new ClientStore();
    const target = mountInto(Shell, {
      store,
      status: ConnectionStatus.Connected,
      onSelectSession: () => undefined,
      onPrompt: () => undefined,
      onBash: () => undefined,
      onAbort: () => undefined,
      onListDirectory: () => undefined,
      onPreviewFile: () => undefined,
      onDownloadFile: () => undefined,
    });

    const message: ServerMessage = snapshotOf([
      userEntry("entry-1", "first message"),
      userEntry("entry-2", "second message"),
    ]);
    flushSync(() => {
      store.receive(message);
    });

    const rows = [...target.querySelectorAll('[data-testid="transcript-entry"]')];
    // Each row also carries its copy control, so compare the trimmed message text.
    expect(rows.map((row) => row.textContent?.trim())).toEqual(["first message", "second message"]);
    expect(target.querySelector('[data-testid="transcript"]')).not.toBeNull();
  });
});

describe("the connection status indicator", () => {
  it.each([
    [ConnectionStatus.Connecting, "Connecting"],
    [ConnectionStatus.Connected, "Connected"],
    [ConnectionStatus.Reconnecting, "Reconnecting"],
  ])("shows %s with its label", (status, label) => {
    const target = mountInto(ConnectionStatusIndicator, { status });

    const indicator = target.querySelector('[data-testid="connection-status"]');
    expect(indicator?.getAttribute("data-status")).toBe(status);
    expect(target.textContent).toContain(label);
  });
});

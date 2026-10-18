import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  ProjectionDeltaKind,
  ServerMessageType,
  SubagentRunKind,
  SubagentStatus,
  type DeltaMessage,
  type ProjectedEntry,
  type ProjectionDelta,
  type ServerMessage,
  type SnapshotMessage,
  type SubagentAgent,
  type SubagentTranscript,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";

const SESSION_ID = "session-1";
const AGENT_ID = "agent-1";

function message(
  id: string,
  text: string,
  role: "user" | "assistant" = "assistant",
): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id,
    parentId: null,
    role,
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

function agent(id: string, handle: string): SubagentAgent {
  return {
    id,
    handle,
    type: "general-purpose",
    status: SubagentStatus.Running,
    runKind: SubagentRunKind.Agent,
  };
}

function snapshotOf(
  agents: readonly SubagentAgent[],
  transcripts: readonly SubagentTranscript[],
): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    session: { project: "/workspace", id: SESSION_ID },
    cursor: 1,
    projection: {
      sessionId: SESSION_ID,
      leafId: "main-1",
      entries: [message("main-1", "the Session's own conversation", "user")],
      runState: { kind: "idle" },
      subagents: agents,
      subagentTranscripts: transcripts,
    },
  };
}

function deltaOf(deltas: readonly ProjectionDelta[], fromCursor: number): DeltaMessage {
  return {
    type: ServerMessageType.Delta,
    session: { project: "/workspace", id: SESSION_ID },
    fromCursor,
    cursor: fromCursor + deltas.length,
    deltas,
  };
}

interface MountedShell {
  readonly store: ClientStore;
  readonly target: HTMLElement;
  focusAgent(): void;
  readonly transcriptText: string;
  readonly entryIds: readonly string[];
}

function mountShell(): MountedShell {
  const store = new ClientStore();
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status: ConnectionStatus.Connected,
        onSelectSession: () => undefined,
        onPrompt: () => undefined,
        onBash: () => undefined,
        onAbort: () => undefined,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: () => undefined,
      },
    });
  });

  const click = (testId: string): void => {
    flushSync();
    const element = target.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (element === null) {
      throw new Error(`no ${testId}`);
    }
    element.click();
    flushSync();
  };

  return {
    store,
    target,
    focusAgent() {
      click("agent-pill");
      flushSync();
      const row = target.querySelector<HTMLElement>(
        '[data-testid="agent-row"][data-row-kind="agent"]',
      );
      if (row === null) {
        throw new Error("no agent row to focus");
      }
      row.click();
      flushSync();
    },
    get transcriptText() {
      flushSync();
      return target.querySelector<HTMLElement>('[data-testid="transcript"]')?.textContent ?? "";
    },
    get entryIds() {
      flushSync();
      return [...target.querySelectorAll<HTMLElement>('[data-testid="transcript-entry"]')].map(
        (entry) => entry.dataset["entryId"] ?? "",
      );
    },
  };
}

function receive(shell: MountedShell, ...messages: readonly ServerMessage[]): void {
  for (const message of messages) {
    shell.store.receive(message);
  }
  flushSync();
}

describe("a focused subagent's transcript", () => {
  it("takes over the transcript view with the agent's conversation and gives main back", () => {
    const shell = mountShell();
    receive(
      shell,
      snapshotOf(
        [agent(AGENT_ID, "explore")],
        [
          {
            agentId: AGENT_ID,
            entries: [message("agent-1", "the agent's own conversation", "user")],
          },
        ],
      ),
    );

    expect(shell.transcriptText).toContain("the Session's own conversation");

    shell.focusAgent();

    expect(shell.transcriptText).toContain("the agent's own conversation");
    expect(shell.transcriptText).not.toContain("the Session's own conversation");
    expect(shell.entryIds).toEqual(["agent-1"]);
  });

  it("updates a streamed entry in place instead of remounting the row", () => {
    const shell = mountShell();
    receive(
      shell,
      snapshotOf(
        [agent(AGENT_ID, "explore")],
        [{ agentId: AGENT_ID, entries: [message("agent-1", "the agent", "user")] }],
      ),
    );
    shell.focusAgent();

    receive(
      shell,
      deltaOf(
        [
          {
            kind: ProjectionDeltaKind.SubagentEntryUpsert,
            agentId: AGENT_ID,
            entry: message("agent-1", "the agent is working"),
          },
        ],
        1,
      ),
    );
    const row = shell.target.querySelector<HTMLElement>('[data-testid="transcript-entry"]');
    expect(shell.transcriptText).toContain("the agent is working");

    receive(
      shell,
      deltaOf(
        [
          {
            kind: ProjectionDeltaKind.SubagentEntryUpsert,
            agentId: AGENT_ID,
            entry: message("agent-1", "the agent is working on it"),
          },
        ],
        2,
      ),
    );

    expect(shell.transcriptText).toContain("the agent is working on it");
    expect(shell.entryIds).toEqual(["agent-1"]);
    // The same element still carries the row: a re-render would replace the node and lose the
    // reader's scroll position and selection.
    expect(shell.target.querySelector('[data-testid="transcript-entry"]')).toBe(row);
  });

  it("keeps the focused agent's conversation across a resync", () => {
    const shell = mountShell();
    receive(
      shell,
      snapshotOf(
        [agent(AGENT_ID, "explore")],
        [{ agentId: AGENT_ID, entries: [message("agent-1", "before the drop", "user")] }],
      ),
    );
    shell.focusAgent();
    expect(shell.transcriptText).toContain("before the drop");

    // A resync after a reconnect is a fresh Snapshot of the same Session, not a Delta continuation.
    receive(
      shell,
      snapshotOf(
        [agent(AGENT_ID, "explore")],
        [
          {
            agentId: AGENT_ID,
            entries: [
              message("agent-1", "before the drop", "user"),
              message("agent-2", "after the drop"),
            ],
          },
        ],
      ),
    );

    expect(shell.transcriptText).toContain("before the drop");
    expect(shell.transcriptText).toContain("after the drop");
    expect(shell.transcriptText).not.toContain("the Session's own conversation");
  });
});

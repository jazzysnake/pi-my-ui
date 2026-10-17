import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  ServerMessageType,
  SubagentRunKind,
  SubagentStatus,
  type ProjectedEntry,
  type ServerMessage,
  type SnapshotMessage,
  type SubagentAgent,
  type SubagentTranscriptLookup,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";

const SESSION_ID = "session-1";
const AGENT_ID = "a1b2c3d4-0000-4000-8000-000000000001";

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

function agent(
  id: string,
  handle: string,
  status: SubagentStatus = SubagentStatus.Completed,
): SubagentAgent {
  return {
    id,
    handle,
    type: "general-purpose",
    status,
    runKind: SubagentRunKind.Agent,
    startedAt: 1_000,
    finishedAt: 2_000,
  };
}

function snapshotOf(
  agents: readonly SubagentAgent[],
  transcriptEntries: readonly ProjectedEntry[] = [],
): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: SESSION_ID,
    cursor: 1,
    projection: {
      sessionId: SESSION_ID,
      cwd: "/workspace",
      leafId: "main-1",
      entries: [message("main-1", "the Session's own conversation", "user")],
      runState: { kind: "idle" },
      subagents: agents,
      subagentTranscripts:
        transcriptEntries.length === 0
          ? []
          : [{ agentId: agents[0]?.id ?? AGENT_ID, entries: transcriptEntries }],
    },
  };
}

interface MountedShell {
  readonly store: ClientStore;
  readonly target: HTMLElement;
  /** The agents a past-transcript read was asked for, in order. */
  readonly pastRequests: readonly string[];
  focusAgent(): void;
  readonly transcriptText: string;
  readonly emptyText: string | null;
}

function mountShell(): MountedShell {
  const store = new ClientStore();
  const pastRequests: string[] = [];
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
        onGetSubagentTranscript: (agentId: string) => {
          pastRequests.push(agentId);
        },
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
    pastRequests,
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
    get emptyText() {
      flushSync();
      return (
        target.querySelector<HTMLElement>('[data-testid="transcript-empty"]')?.textContent ?? null
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

describe("a settled subagent run opened from its own session file", () => {
  it("asks for the run's conversation on disk and shows it in the transcript view", () => {
    const shell = mountShell();
    receive(shell, snapshotOf([agent(AGENT_ID, "general-purpose")]));

    shell.focusAgent();

    // Nothing was streamed from this run, so the only source is the file pi-subagents wrote.
    expect(shell.pastRequests).toEqual([AGENT_ID]);

    receive(shell, {
      type: ServerMessageType.SubagentTranscript,
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
      kind: "found",
      entries: [message("child-1", "the run's own conversation", "assistant")],
    });

    expect(shell.transcriptText).toContain("the run's own conversation");
    expect(shell.transcriptText).not.toContain("the Session's own conversation");
    expect(shell.emptyText).toBeNull();
  });

  it("does not ask for a run whose conversation this process already streamed", () => {
    const shell = mountShell();
    receive(
      shell,
      snapshotOf([agent(AGENT_ID, "general-purpose")], [message("child-1", "streamed live")]),
    );

    shell.focusAgent();

    expect(shell.pastRequests).toEqual([]);
    expect(shell.transcriptText).toContain("streamed live");
  });
});

describe("an empty subagent transcript says which kind of empty it is", () => {
  function focusedShell(status: SubagentStatus): MountedShell {
    const shell = mountShell();
    receive(shell, snapshotOf([agent(AGENT_ID, "general-purpose", status)]));
    shell.focusAgent();
    return shell;
  }

  function lookup(shell: MountedShell, outcome: SubagentTranscriptLookup): void {
    receive(shell, {
      type: ServerMessageType.SubagentTranscript,
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
      ...outcome,
    });
  }

  it("says a settled run finished when its own session file holds no message", () => {
    const shell = focusedShell(SubagentStatus.Completed);

    lookup(shell, { kind: "found", entries: [] });

    expect(shell.emptyText).toBe("@general-purpose has finished without writing a message.");
    expect(shell.emptyText).not.toContain("no messages yet");
  });

  it("says a run that has not produced a turn yet has no messages yet", () => {
    const shell = focusedShell(SubagentStatus.Running);

    expect(shell.emptyText).toBe("This subagent has no messages yet.");
  });

  it("says a settled run's conversation is gone when no file names it", () => {
    const shell = focusedShell(SubagentStatus.Completed);

    lookup(shell, { kind: "absent" });

    expect(shell.emptyText).toBe(
      "@general-purpose has finished; its conversation is no longer available.",
    );
  });

  it("says why a conversation could not be opened, in the server's own words", () => {
    const shell = focusedShell(SubagentStatus.Completed);

    lookup(shell, {
      kind: "unavailable",
      reason: "more than one run or child session matches this agent's id",
    });

    expect(shell.emptyText).toBe(
      "This subagent's transcript is unavailable: more than one run or child session matches this agent's id",
    );
  });
});

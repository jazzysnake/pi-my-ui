import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it, vi } from "vitest";

import {
  EntryKind,
  ProjectionDeltaKind,
  RunStateKind,
  ServerMessageType,
  SubagentRunKind,
  SubagentStatus,
  type DeltaMessage,
  type ProjectedEntry,
  type ProjectionDelta,
  type RunState,
  type ServerMessage,
  type SnapshotMessage,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";

const SESSION_ID = "session-1";
const AGENT_ID = "agent-1";

function entry(id: string, role: "user" | "assistant", text: string): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id,
    parentId: null,
    role,
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

function agent(status: SubagentStatus): SubagentAgent {
  return {
    id: AGENT_ID,
    handle: "explore",
    type: "general-purpose",
    status,
    runKind: SubagentRunKind.Agent,
    startedAt: 0,
  };
}

function snapshotOf(
  status: SubagentStatus,
  transcript: readonly ProjectedEntry[],
  runState: RunState = { kind: RunStateKind.Idle },
): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    session: { project: "/workspace", id: SESSION_ID },
    cursor: 1,
    projection: {
      sessionId: SESSION_ID,
      leafId: "main-1",
      entries: [entry("main-1", "user", "the Session's own conversation")],
      runState,
      subagents: [agent(status)],
      subagentTranscripts: [{ agentId: AGENT_ID, entries: transcript }],
    },
  };
}

function settledDelta(fromCursor: number): DeltaMessage {
  const deltas: readonly ProjectionDelta[] = [
    {
      kind: ProjectionDeltaKind.SubagentUpsert,
      agent: { ...agent(SubagentStatus.Completed), finishedAt: 1 },
    },
  ];
  return {
    type: ServerMessageType.Delta,
    session: { project: "/workspace", id: SESSION_ID },
    fromCursor,
    cursor: fromCursor + deltas.length,
    deltas,
  };
}

function deliveryDelta(text: string, fromCursor: number): DeltaMessage {
  const deltas: readonly ProjectionDelta[] = [
    {
      kind: ProjectionDeltaKind.SubagentEntryUpsert,
      agentId: AGENT_ID,
      entry: entry("agent-steer-1", "user", text),
    },
  ];
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
  readonly steer: ReturnType<typeof vi.fn>;
  readonly prompt: ReturnType<typeof vi.fn>;
  focusAgent(): void;
  typeInput(value: string): void;
  send(): void;
  sendWhileRunning(): void;
  read(testId: string): HTMLElement | null;
}

function mountShell(): MountedShell {
  const store = new ClientStore();
  const steer = vi.fn();
  const prompt = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status: ConnectionStatus.Connected,
        onSelectSession: () => undefined,
        onPrompt: prompt,
        onSteerSubagent: steer,
        onBash: () => undefined,
        onAbort: () => undefined,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: () => undefined,
      },
    });
  });

  const before = (): void => {
    flushSync();
  };

  return {
    store,
    target,
    steer,
    prompt,
    focusAgent() {
      before();
      const pill = target.querySelector<HTMLElement>('[data-testid="agent-pill"]');
      pill?.click();
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
    typeInput(value) {
      const input = target.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
      if (input === null) {
        throw new Error("the composer input is missing");
      }
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
    },
    send() {
      const button = target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]');
      if (button === null) {
        throw new Error("the send control is missing");
      }
      button.click();
      flushSync();
    },
    sendWhileRunning() {
      const button = target.querySelector<HTMLButtonElement>(
        '[data-testid="composer-send-while-running"]',
      );
      if (button === null) {
        throw new Error("the send-while-running control is missing");
      }
      button.click();
      flushSync();
    },
    read(testId) {
      flushSync();
      return target.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    },
  };
}

describe("steering a focused subagent", () => {
  it("refuses to send to a settled agent and states why", () => {
    const shell = mountShell();
    shell.store.receive(snapshotOf(SubagentStatus.Completed, []));
    shell.focusAgent();
    shell.typeInput("check the lexer too");

    const refusal = shell.read("steer-refusal");
    expect(refusal?.textContent).toContain("settled");
    expect(shell.read("composer-send")?.hasAttribute("disabled")).toBe(true);

    shell.send();
    expect(shell.steer).not.toHaveBeenCalled();
    expect(shell.prompt).not.toHaveBeenCalled();
  });

  it("states the queued reason rather than the settled one", () => {
    const shell = mountShell();
    shell.store.receive(snapshotOf(SubagentStatus.Queued, []));
    shell.focusAgent();
    shell.typeInput("check the lexer too");

    const refusal = shell.read("steer-refusal");
    expect(refusal?.textContent).toContain("queued");
    expect(refusal?.textContent).not.toContain("settled");
  });

  it("sends typed text to the focused running agent instead of the Session", () => {
    const shell = mountShell();
    shell.store.receive(snapshotOf(SubagentStatus.Running, []));
    shell.focusAgent();
    shell.typeInput("check the lexer too");
    shell.send();

    expect(shell.steer).toHaveBeenCalledWith(AGENT_ID, "check the lexer too");
    expect(shell.prompt).not.toHaveBeenCalled();
  });

  it("steers while the Session's own run is still streaming", () => {
    const shell = mountShell();
    shell.store.receive(snapshotOf(SubagentStatus.Running, [], { kind: RunStateKind.Streaming }));
    shell.focusAgent();
    shell.typeInput("check the lexer too");
    shell.sendWhileRunning();

    expect(shell.steer).toHaveBeenCalledWith(AGENT_ID, "check the lexer too");
    expect(shell.prompt).not.toHaveBeenCalled();
  });

  it("shows the steer in flight until the agent's conversation carries it", () => {
    const shell = mountShell();
    shell.store.receive(snapshotOf(SubagentStatus.Running, []));
    shell.focusAgent();
    shell.typeInput("check the lexer too");
    shell.send();

    const pending = shell.read("steer-pending");
    expect(pending?.textContent).toContain("@explore");
    expect(pending?.getAttribute("data-steer-agent-id")).toBe(AGENT_ID);

    shell.store.receive(deliveryDelta("check the lexer too", 1));
    expect(shell.read("steer-pending")).toBeNull();
  });

  it("does not leave the steer in flight when the agent settles without it", () => {
    const shell = mountShell();
    shell.store.receive(snapshotOf(SubagentStatus.Running, []));
    shell.focusAgent();
    shell.typeInput("check the lexer too");
    shell.send();
    expect(shell.read("steer-pending")).not.toBeNull();

    shell.store.receive(settledDelta(1));

    expect(shell.read("steer-pending")).toBeNull();
  });

  it("clears the steer in flight when the server refuses it", () => {
    const shell = mountShell();
    shell.store.receive(snapshotOf(SubagentStatus.Running, []));
    shell.focusAgent();
    shell.typeInput("check the lexer too");
    shell.send();
    expect(shell.read("steer-pending")).not.toBeNull();

    const refusal: ServerMessage = {
      type: ServerMessageType.Error,
      session: { project: "/workspace", id: SESSION_ID },
      error: {
        code: "commandFailed",
        message:
          'Agent "agent-1" is not running (status: completed). Cannot steer a non-running agent.',
      },
    };
    shell.store.receive(refusal);

    expect(shell.read("steer-pending")).toBeNull();
    expect(shell.read("composer-error")?.textContent).toContain("not running");
  });
});

import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  ServerMessageType,
  SubagentRunKind,
  SubagentStatus,
  WORKFLOW_RUN_TYPE,
  type SnapshotMessage,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";

const SESSION_ID = "session-1";
/** Long enough to render a stable `1m`, short enough that the bucket cannot roll during the test. */
const ELAPSED_ANCHOR_MS = 65_000;

function snapshotOf(subagents: readonly SubagentAgent[]): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: SESSION_ID,
    cursor: 1,
    projection: {
      sessionId: SESSION_ID,
      cwd: "/workspace",
      leafId: "entry-1",
      entries: [
        {
          id: "entry-1",
          parentId: null,
          kind: EntryKind.Message,
          role: "user",
          timestamp: 0,
          blocks: [{ type: "text", text: "Ask a subagent" }],
        },
      ],
      runState: { kind: "idle" },
      subagents,
    },
  };
}

function agent(
  id: string,
  handle: string,
  type: string,
  status: SubagentStatus,
  startedAt: number,
): SubagentAgent {
  return { id, handle, type, status, runKind: SubagentRunKind.Agent, startedAt };
}

function workflowRun(id: string, handle: string, status: SubagentStatus): SubagentAgent {
  return {
    id,
    handle,
    type: WORKFLOW_RUN_TYPE,
    status,
    runKind: SubagentRunKind.Workflow,
    startedAt: Date.now() - ELAPSED_ANCHOR_MS,
  };
}

interface MountedShell {
  readonly store: ClientStore;
  readonly target: HTMLElement;
  readonly pillLabel: () => string;
  readonly pillKind: () => string;
  openList(): void;
  rows(): readonly HTMLElement[];
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
    pillLabel() {
      flushSync();
      return (
        target.querySelector<HTMLElement>('[data-testid="agent-pill-label"]')?.textContent ?? ""
      );
    },
    pillKind() {
      flushSync();
      return (
        target.querySelector<HTMLElement>('[data-testid="agent-pill"]')?.dataset["pillKind"] ?? ""
      );
    },
    openList() {
      click("agent-pill");
    },
    rows() {
      flushSync();
      return [...target.querySelectorAll<HTMLElement>('[data-testid="agent-row"]')];
    },
  };
}

function text(row: HTMLElement, testId: string): string {
  return row.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.textContent?.trim() ?? "";
}

describe("the agent list", () => {
  it("opens from the pill and shows each agent's type, name, status and elapsed time", () => {
    const shell = mountShell();
    shell.store.receive(
      snapshotOf([
        agent(
          "a1",
          "explore",
          "general-purpose",
          SubagentStatus.Running,
          Date.now() - ELAPSED_ANCHOR_MS,
        ),
      ]),
    );

    shell.openList();

    const rows = shell.rows();
    expect(rows.map((row) => row.dataset["rowKind"])).toEqual(["main", "agent"]);
    const agentRow = rows[1];
    expect(agentRow).toBeDefined();
    if (agentRow === undefined) {
      return;
    }
    expect(text(agentRow, "agent-row-type")).toBe("general-purpose");
    expect(text(agentRow, "agent-row-name")).toBe("@explore");
    expect(text(agentRow, "agent-row-status")).toBe("running");
    expect(text(agentRow, "agent-row-elapsed")).toBe("1m");
  });

  it("focuses the agent whose row is tapped, and main returns the view", () => {
    const shell = mountShell();
    shell.store.receive(
      snapshotOf([agent("a1", "explore", "general-purpose", SubagentStatus.Completed, Date.now())]),
    );
    expect(shell.pillLabel()).toBe("main");

    shell.openList();
    shell.rows()[1]?.click();
    flushSync();
    expect(shell.pillLabel()).toBe("@explore");

    shell.openList();
    shell.rows()[0]?.click();
    flushSync();
    expect(shell.pillLabel()).toBe("main");
  });

  it("shows a workflow run as its own row that cannot be focused", () => {
    const shell = mountShell();
    shell.store.receive(
      snapshotOf([
        agent("a1", "explore", "general-purpose", SubagentStatus.Running, Date.now()),
        workflowRun("wf_1", "auth-audit", SubagentStatus.Running),
      ]),
    );

    shell.openList();

    const rows = shell.rows();
    expect(rows.map((row) => row.dataset["rowKind"])).toEqual(["main", "agent", "workflow"]);
    const workflowRow = rows[2];
    expect(workflowRow).toBeDefined();
    if (workflowRow === undefined) {
      return;
    }
    expect(text(workflowRow, "agent-row-type")).toBe("workflow");
    expect(text(workflowRow, "agent-row-name")).toBe("auth-audit");
    expect(text(workflowRow, "agent-row-status")).toBe("running");
    expect(text(workflowRow, "agent-row-elapsed")).toBe("1m");

    workflowRow.click();
    flushSync();
    expect(shell.pillKind()).toBe("main");
  });

  it("drops the focused agent's name when the Session stops reporting it", () => {
    const shell = mountShell();
    shell.store.receive(
      snapshotOf([agent("a1", "explore", "general-purpose", SubagentStatus.Running, Date.now())]),
    );
    shell.openList();
    shell.rows()[1]?.click();
    flushSync();
    expect(shell.pillLabel()).toBe("@explore");

    shell.store.receive(
      snapshotOf([agent("a2", "plan", "Plan", SubagentStatus.Running, Date.now())]),
    );
    expect(shell.pillLabel()).toBe("main +1");
  });
});

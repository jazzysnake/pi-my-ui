import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  EntryKind,
  ProjectionDeltaKind,
  ServerMessageType,
  SubagentStatus,
  type DeltaMessage,
  type ProjectedEntry,
  type SnapshotMessage,
  type SubagentAgent,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";

const SESSION_ID = "session-1";

function snapshotOf(subagents: readonly SubagentAgent[]): SnapshotMessage {
  const entries: readonly ProjectedEntry[] = [
    {
      id: "entry-1",
      parentId: null,
      kind: EntryKind.Message,
      role: "user",
      timestamp: 0,
      blocks: [{ type: "text", text: "Ask a subagent" }],
    },
  ];
  return {
    type: ServerMessageType.Snapshot,
    sessionId: SESSION_ID,
    cursor: entries.length,
    projection: {
      sessionId: SESSION_ID,
      cwd: "/workspace",
      leafId: "entry-1",
      entries,
      runState: { kind: "idle" },
      subagents,
    },
  };
}

function agentDelta(agent: SubagentAgent, fromCursor: number): DeltaMessage {
  return {
    type: ServerMessageType.Delta,
    sessionId: SESSION_ID,
    fromCursor,
    cursor: fromCursor + 1,
    deltas: [{ kind: ProjectionDeltaKind.SubagentUpsert, agent }],
  };
}

function agent(id: string, handle: string, status: SubagentStatus): SubagentAgent {
  return { id, handle, status };
}

interface MountedPill {
  readonly store: ClientStore;
  readonly target: HTMLElement;
  read(): { kind: string; label: string } | null;
}

function mountPill(): MountedPill {
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
  return {
    store,
    target,
    read() {
      flushSync();
      const pill = target.querySelector<HTMLElement>('[data-testid="agent-pill"]');
      if (pill === null) {
        return null;
      }
      const label = pill.querySelector<HTMLElement>('[data-testid="agent-pill-label"]');
      return { kind: pill.dataset["pillKind"] ?? "", label: label?.textContent ?? "" };
    },
  };
}

describe("the agent pill", () => {
  it("is absent when the Session has no subagents", () => {
    const pill = mountPill();
    pill.store.receive(snapshotOf([]));
    expect(pill.read()).toBeNull();
  });

  it("shows main and the number of active agents", () => {
    const pill = mountPill();
    pill.store.receive(
      snapshotOf([
        agent("a1", "explore", SubagentStatus.Running),
        agent("a2", "plan", SubagentStatus.Queued),
      ]),
    );
    expect(pill.read()).toEqual({ kind: "main", label: "main +2" });
  });

  it("shows the focused agent's handle and counts the other active agents", () => {
    const pill = mountPill();
    pill.store.receive(
      snapshotOf([
        agent("a1", "explore", SubagentStatus.Running),
        agent("a2", "plan", SubagentStatus.Running),
        agent("a3", "review", SubagentStatus.Completed),
      ]),
    );

    pill.store.subagents.focus("a1");
    expect(pill.read()).toEqual({ kind: "subagent", label: "@explore +1" });

    pill.store.subagents.focus(null);
    expect(pill.read()).toEqual({ kind: "main", label: "main +2" });
  });

  it("drops the count once the agents settle", () => {
    const pill = mountPill();
    pill.store.receive(snapshotOf([agent("a1", "explore", SubagentStatus.Running)]));
    expect(pill.read()).toEqual({ kind: "main", label: "main +1" });

    pill.store.receive(agentDelta(agent("a1", "explore", SubagentStatus.Completed), 1));
    expect(pill.read()).toEqual({ kind: "main", label: "main" });
  });

  it("falls back to main when the focused agent is gone", () => {
    const pill = mountPill();
    pill.store.receive(snapshotOf([agent("a1", "explore", SubagentStatus.Running)]));
    pill.store.subagents.focus("a1");
    expect(pill.read()).toEqual({ kind: "subagent", label: "@explore" });

    pill.store.receive(snapshotOf([agent("a2", "plan", SubagentStatus.Running)]));
    expect(pill.read()).toEqual({ kind: "main", label: "main +1" });
  });
});

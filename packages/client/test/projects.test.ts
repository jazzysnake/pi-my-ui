import { describe, expect, it } from "vitest";

import {
  ServerMessageType,
  SessionActivity,
  type CommandInfo,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import { resolveClientConfig } from "../src/lib/config.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

const PROJECT_A = "/workspace/api";
const PROJECT_B = "/workspace/oss/api";
const SESSION = { project: PROJECT_A, id: "session-1" };

function snapshotOf(session = SESSION): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    session,
    cursor: 0,
    projection: {
      sessionId: session.id,
      leafId: null,
      entries: [],
      runState: { kind: "idle" },
      subagents: [],
      subagentTranscripts: [],
    },
  };
}

describe("the Project named by the page address", () => {
  it("reads ?project= beside ?session= and ?ws=", () => {
    const config = resolveClientConfig(
      "http://phone.local/",
      `?project=${encodeURIComponent(PROJECT_A)}&session=abc&ws=ws%3A%2F%2Fphone.local%2Fws`,
    );
    expect(config.project).toBe(PROJECT_A);
    expect(config.sessionId).toBe("abc");
    expect(config.wsUrl).toBe("ws://phone.local/ws");
  });
});

describe("the Projects slice", () => {
  it("chooses the linked Project when the registry serves it", () => {
    const store = new ClientStore(PROJECT_B);
    store.receive({ type: ServerMessageType.Projects, projects: [PROJECT_A, PROJECT_B] });
    expect(store.projects.chosen).toBe(PROJECT_B);
  });

  it("chooses the first Project when the address names none", () => {
    const store = new ClientStore();
    store.receive({ type: ServerMessageType.Projects, projects: [PROJECT_A, PROJECT_B] });
    expect(store.projects.chosen).toBe(PROJECT_A);
  });

  it("chooses nothing when the linked Project is no longer served", () => {
    const store = new ClientStore("/gone/project");
    store.receive({ type: ServerMessageType.Projects, projects: [PROJECT_A, PROJECT_B] });
    expect(store.projects.chosen).toBeNull();
  });
});

describe("routing by the carried Session pair", () => {
  it("ignores another Project's Session list", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive({ type: ServerMessageType.Projects, projects: [PROJECT_A, PROJECT_B] });
    store.receive({
      type: ServerMessageType.Sessions,
      project: PROJECT_B,
      sessions: [{ id: "other", name: null, firstMessage: null, lastActivityAt: 1 }],
      activity: { other: SessionActivity.Working },
    });
    expect(store.sessions.rows).toBeNull();
  });

  it("accepts the chosen Project's list and its activity", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive({ type: ServerMessageType.Projects, projects: [PROJECT_A, PROJECT_B] });
    store.receive({
      type: ServerMessageType.Sessions,
      project: PROJECT_A,
      sessions: [{ id: SESSION.id, name: null, firstMessage: null, lastActivityAt: 1 }],
      activity: { [SESSION.id]: SessionActivity.Working },
    });
    expect(store.sessions.rows).toHaveLength(1);
    expect(store.sessions.rows?.[0]?.working).toBe(true);
  });

  it("keeps Settings, Commands and ContextUsage to the Session in the transcript", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive(snapshotOf());

    const command: CommandInfo = {
      name: "review",
      description: "Review the working tree",
      source: "prompt",
    };
    const other = { project: PROJECT_B, id: SESSION.id };
    store.receive({ type: ServerMessageType.Settings, session: other, ...settings() });
    store.receive({ type: ServerMessageType.Commands, session: other, commands: [command] });
    store.receive({
      type: ServerMessageType.ContextUsage,
      session: other,
      contextUsage: { tokens: 1, contextWindow: 2, percent: 50 },
    });
    expect(store.settings.settings).toBeNull();
    expect(store.commands.discoverable).toEqual([]);
    expect(store.context.usage).toBeUndefined();

    store.receive({ type: ServerMessageType.Settings, session: SESSION, ...settings() });
    expect(store.settings.settings?.session).toEqual(SESSION);
  });
});

function settings() {
  return {
    model: null,
    availableModels: [],
    thinkingLevel: "off" as const,
    availableThinkingLevels: ["off" as const],
    autoCompactionEnabled: false,
  };
}

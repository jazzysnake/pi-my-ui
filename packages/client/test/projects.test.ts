import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it } from "vitest";

import {
  ServerMessageType,
  SessionActivity,
  type CommandInfo,
  type ServerMessage,
  type SessionSummary,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import ProjectPicker from "../src/lib/ProjectPicker.svelte";
import Shell from "../src/lib/Shell.svelte";
import { projectAddress, resolveClientConfig } from "../src/lib/config.js";
import type { ProjectStorage } from "../src/lib/projects/storage.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";

const PROJECT_A = "/workspace/api";
const PROJECT_B = "/workspace/oss/api";
const SESSION = { project: PROJECT_A, id: "session-1" };
const GONE = "/workspace/retired";

function projectsMessage(projects: readonly string[]): ServerMessage {
  return { type: ServerMessageType.Projects, projects };
}

function sessionsMessage(
  project: string,
  ids: readonly string[],
  activity: Readonly<Record<string, SessionActivity>> = {},
): ServerMessage {
  return {
    type: ServerMessageType.Sessions,
    project,
    sessions: ids.map((id): SessionSummary => ({
      id,
      name: null,
      firstMessage: null,
      lastActivityAt: 1,
    })),
    activity,
  };
}

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

/** A device's remembered Project, inspectable so a test can see what was written back. */
function memoryOf(initial: string | null = null): ProjectStorage & { current: string | null } {
  let current = initial;
  return {
    get current() {
      return current;
    },
    read: () => current,
    write(project) {
      current = project;
    },
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

function mountShell(
  store: ClientStore,
  onSelectProject: (project: string) => void = () => undefined,
): HTMLElement {
  return mountInto(Shell as Component<Record<string, unknown>>, {
    store,
    status: ConnectionStatus.Connected,
    onSelectProject,
    onSelectSession: () => undefined,
    onPrompt: () => undefined,
    onBash: () => undefined,
    onAbort: () => undefined,
    onListDirectory: () => undefined,
    onPreviewFile: () => undefined,
    onDownloadFile: () => undefined,
  });
}

function click(target: HTMLElement, testId: string, index = 0): void {
  const element = [...target.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)][index];
  if (element === undefined) {
    throw new Error(`no element ${testId} at ${index}`);
  }
  flushSync(() => {
    element.click();
  });
}

function filesToggle(target: HTMLElement): HTMLButtonElement {
  const toggle = target.querySelector<HTMLButtonElement>('[data-testid="files-toggle"]');
  if (toggle === null) {
    throw new Error("the files control is missing");
  }
  return toggle;
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

  it("keeps a chosen Project and its Session in the address, with the ws override", () => {
    const address = new URL(
      projectAddress("http://phone.local/#top", PROJECT_A, "abc", "ws://phone.local/ws"),
    );
    expect(address.hash).toBe("#top");
    expect(address.searchParams.get("project")).toBe(PROJECT_A);
    expect(address.searchParams.get("session")).toBe("abc");
    expect(address.searchParams.get("ws")).toBe("ws://phone.local/ws");

    const without = new URL(projectAddress("http://phone.local/", PROJECT_B, null, null));
    expect(without.searchParams.get("project")).toBe(PROJECT_B);
    expect(without.searchParams.has("session")).toBe(false);
    expect(without.searchParams.has("ws")).toBe(false);
  });
});

describe("the Projects slice", () => {
  it("shows the picker when nothing is remembered", () => {
    const store = new ClientStore();
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    expect(store.projects.chosen).toBeNull();
    expect(store.projects.warning).toBeNull();
  });

  it("chooses the linked Project when the registry serves it", () => {
    const store = new ClientStore(PROJECT_B);
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    expect(store.projects.chosen).toBe(PROJECT_B);
  });

  it("skips the picker when the server serves exactly one Project", () => {
    const store = new ClientStore();
    store.receive(projectsMessage([PROJECT_A]));
    expect(store.projects.chosen).toBe(PROJECT_A);
  });

  it("remembers the chosen Project and recalls it on the next visit", () => {
    const memory = memoryOf();
    const first = new ClientStore(null, memory);
    first.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    first.selectProject(PROJECT_B);
    expect(memory.current).toBe(PROJECT_B);

    const next = new ClientStore(null, memory);
    next.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    expect(next.projects.chosen).toBe(PROJECT_B);
  });

  it("shows the picker and names a remembered Project the server no longer serves", () => {
    const store = new ClientStore(null, memoryOf(GONE));
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    expect(store.projects.chosen).toBeNull();
    expect(store.projects.warning).toContain(GONE);
  });

  it("shows the picker and names a linked Project the server does not serve", () => {
    const store = new ClientStore(GONE);
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    expect(store.projects.chosen).toBeNull();
    expect(store.projects.warning).toContain(GONE);
  });

  it("keeps the picker when the only served Project is not the remembered one", () => {
    const store = new ClientStore(null, memoryOf(GONE));
    store.receive(projectsMessage([PROJECT_A]));
    expect(store.projects.chosen).toBeNull();
    expect(store.projects.warning).toContain(GONE);
  });

  it("lets the linked Project win over a remembered one", () => {
    const memory = memoryOf(PROJECT_A);
    const store = new ClientStore(PROJECT_B, memory);
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    expect(store.projects.chosen).toBe(PROJECT_B);
    expect(memory.current).toBe(PROJECT_B);
  });

  it("keeps the chosen Project's list when that Project is chosen again", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    store.receive(sessionsMessage(PROJECT_A, [SESSION.id]));

    store.selectProject(PROJECT_A);
    expect(store.projects.chosen).toBe(PROJECT_A);
    expect(store.sessions.rows?.map((row) => row.summary.id)).toEqual([SESSION.id]);
  });

  it("clears the notice once a Project is chosen", () => {
    const store = new ClientStore(null, memoryOf(GONE));
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    expect(store.projects.warning).not.toBeNull();

    store.selectProject(PROJECT_A);
    expect(store.projects.chosen).toBe(PROJECT_A);
    expect(store.projects.warning).toBeNull();
  });

  it("routes each device's list by the Project that device chose", () => {
    const firstDevice = new ClientStore(null, memoryOf(PROJECT_A));
    firstDevice.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    const secondDevice = new ClientStore(null, memoryOf(PROJECT_B));
    secondDevice.receive(projectsMessage([PROJECT_A, PROJECT_B]));

    firstDevice.receive(sessionsMessage(PROJECT_A, [SESSION.id]));
    secondDevice.receive(sessionsMessage(PROJECT_B, ["session-b"]));
    expect(firstDevice.sessions.rows?.map((row) => row.summary.id)).toEqual([SESSION.id]);
    expect(secondDevice.sessions.rows?.map((row) => row.summary.id)).toEqual(["session-b"]);

    // The other device's push is part of the same message stream only for that device; feeding it
    // here must not move this device's list.
    firstDevice.receive(sessionsMessage(PROJECT_B, ["session-b"]));
    expect(firstDevice.sessions.rows?.map((row) => row.summary.id)).toEqual([SESSION.id]);
  });
});

describe("the Project picker", () => {
  it("distinguishes Projects that share a last segment by their parents", () => {
    const target = mountInto(ProjectPicker, {
      projects: [PROJECT_A, PROJECT_B],
      warning: null,
      onChoose: () => undefined,
    });
    const labels = [...target.querySelectorAll('[data-testid="project-label"]')].map((element) =>
      element.textContent?.trim(),
    );
    expect(labels).toEqual(["workspace/api", "oss/api"]);
  });

  it("states an unserved remembered or linked Project in the warning tone", () => {
    const target = mountInto(ProjectPicker, {
      projects: [PROJECT_A, PROJECT_B],
      warning: `This server no longer serves ${GONE}. Choose a Project below.`,
      onChoose: () => undefined,
    });
    const notice = target.querySelector('[data-testid="project-warning"]');
    expect(notice?.textContent).toContain(GONE);
    expect(notice?.classList).toContain("text-warning");
  });
});

describe("the file control", () => {
  it("is disabled until a Project is chosen, then enabled for that Project", () => {
    const store = new ClientStore();
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    const target = mountShell(store, (project) => store.selectProject(project));
    expect(filesToggle(target).disabled).toBe(true);

    click(target, "project-row", 1);
    expect(store.projects.chosen).toBe(PROJECT_B);
    expect(filesToggle(target).disabled).toBe(false);
  });

  it("is enabled for a single-Project server that chose its Project", () => {
    const store = new ClientStore();
    store.receive(projectsMessage([PROJECT_A]));
    const target = mountShell(store);
    expect(filesToggle(target).disabled).toBe(false);
  });

  it("is disabled while no Project is chosen, even on a single-Project server", () => {
    const store = new ClientStore(null, memoryOf(GONE));
    store.receive(projectsMessage([PROJECT_A]));
    const target = mountShell(store);
    expect(filesToggle(target).disabled).toBe(true);
  });
});

describe("the drawer's Project switcher", () => {
  it("lists Projects, switches, and returns to the chosen Project's Sessions", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    store.receive(sessionsMessage(PROJECT_A, [SESSION.id]));
    const chosen: string[] = [];
    const target = mountShell(store, (project) => {
      chosen.push(project);
      store.selectProject(project);
    });

    click(target, "sessions-toggle");
    expect(
      [...target.querySelectorAll('[data-testid="session-row"]')].map((row) =>
        row.getAttribute("data-session-id"),
      ),
    ).toEqual([SESSION.id]);

    click(target, "project-switch");
    expect(target.querySelectorAll('[data-testid="project-row"]')).toHaveLength(2);

    click(target, "project-row", 1);
    expect(chosen).toEqual([PROJECT_B]);

    flushSync(() => {
      store.receive(sessionsMessage(PROJECT_B, ["session-b"]));
    });
    expect(target.querySelector('[data-testid="session-drawer"]')?.getAttribute("data-level")).toBe(
      "sessions",
    );
    expect(
      [...target.querySelectorAll('[data-testid="session-row"]')].map((row) =>
        row.getAttribute("data-session-id"),
      ),
    ).toEqual(["session-b"]);
    expect(target.querySelector('[data-testid="current-project-label"]')?.textContent?.trim()).toBe(
      "oss/api",
    );
  });
});

describe("routing by the carried Session pair", () => {
  it("ignores another Project's Session list", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    store.receive(sessionsMessage(PROJECT_B, ["other"], { other: SessionActivity.Working }));
    expect(store.sessions.rows).toBeNull();
  });

  it("accepts the chosen Project's list and its activity", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive(projectsMessage([PROJECT_A, PROJECT_B]));
    store.receive(
      sessionsMessage(PROJECT_A, [SESSION.id], { [SESSION.id]: SessionActivity.Working }),
    );
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

  it("ignores another Session's Snapshot until a switch clears the slices", () => {
    const store = new ClientStore(PROJECT_A);
    store.receive(snapshotOf());
    const command: CommandInfo = {
      name: "review",
      description: "Review the working tree",
      source: "prompt",
    };
    store.receive({ type: ServerMessageType.Commands, session: SESSION, commands: [command] });
    store.receive({ type: ServerMessageType.Settings, session: SESSION, ...settings() });

    const other = { project: PROJECT_B, id: "session-2" };
    store.receive(snapshotOf(other));
    expect(store.transcript.sessionId).toBe(SESSION.id);
    expect(store.commands.discoverable).toEqual([command]);
    expect(store.settings.settings?.session).toEqual(SESSION);

    // Choosing the other Session drops every slice, so its own Snapshot is accepted.
    store.selectSession(other);
    store.receive(snapshotOf(other));
    expect(store.transcript.sessionId).toBe(other.id);
    expect(store.commands.discoverable).toEqual([]);
    expect(store.settings.settings).toBeNull();
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

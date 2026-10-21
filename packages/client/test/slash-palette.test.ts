import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";

import {
  CommandSource,
  ProtocolErrorCode,
  ServerMessageType,
  SessionActivity,
  type CommandsMessage,
  type CommandInfo,
  type ErrorMessage,
  type ReloadedMessage,
  type SessionExportedMessage,
  type SessionStats,
  type SessionStatsMessage,
  type SessionsMessage,
} from "@pi-my-ui/protocol";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { ConnectionStatus } from "../src/lib/transport.js";
import {
  SESSION_ID,
  input,
  keydown,
  mountShell,
  snapshotOf,
  settingsOf,
  type,
} from "./composer-harness.js";

const REVIEW: CommandInfo = {
  name: "review",
  description: "Review the working tree",
  source: CommandSource.Prompt,
};

/** A skill that only exists after the reload re-read the agent directory. */
const RELOADED_SKILL: CommandInfo = {
  name: "reloaded-skill",
  description: "A skill the reload discovered",
  source: CommandSource.Skill,
};

function commandsOf(commands: readonly CommandInfo[]): CommandsMessage {
  return {
    type: ServerMessageType.Commands,
    session: { project: "/workspace", id: SESSION_ID },
    commands,
  };
}

function sessionsOf(id: string, name: string): SessionsMessage {
  return {
    type: ServerMessageType.Sessions,
    project: "/workspace",
    sessions: [{ id, name, firstMessage: null, lastActivityAt: 0 }],
    activity: { [id]: SessionActivity.Idle },
  };
}

function statsOf(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionId: SESSION_ID,
    sessionFile: "/sessions/session-1.jsonl",
    userMessages: 2,
    assistantMessages: 2,
    toolCalls: 1,
    totalMessages: 5,
    tokens: { input: 100, output: 40, cacheRead: 0, cacheWrite: 0, total: 140 },
    cost: 0.12,
    contextUsage: null,
    ...overrides,
  };
}

function statsMessageOf(stats: SessionStats = statsOf()): SessionStatsMessage {
  return {
    type: ServerMessageType.SessionStats,
    session: { project: "/workspace", id: SESSION_ID },
    stats,
  };
}

function exportedOf(path: string): SessionExportedMessage {
  return {
    type: ServerMessageType.SessionExported,
    session: { project: "/workspace", id: SESSION_ID },
    path,
  };
}

function reloadedOf(): ReloadedMessage {
  return {
    type: ServerMessageType.Reloaded,
    session: { project: "/workspace", id: SESSION_ID },
  };
}

function refusedReloadOf(message: string): ErrorMessage {
  return {
    type: ServerMessageType.Error,
    session: { project: "/workspace", id: SESSION_ID },
    error: { code: ProtocolErrorCode.CommandFailed, message },
  };
}

/** The keys of every rendered palette row, in order. */
function paletteKeys(target: HTMLElement): (string | null)[] {
  return [...target.querySelectorAll('[data-testid="command-palette-row"]')].map((row) =>
    row.getAttribute("data-entry-key"),
  );
}

function paletteRow(target: HTMLElement, key: string): HTMLElement {
  const row = target.querySelector<HTMLElement>(`[data-entry-key="${key}"]`);
  if (row === null) {
    throw new Error(`the palette row ${key} is missing`);
  }
  return row;
}

function send(target: HTMLElement): void {
  target.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')?.click();
}

describe("the slash palette", () => {
  it("opens on a leading slash and lists built-ins beside pi's discoverable commands", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(commandsOf([REVIEW]));
    });

    expect(target.querySelector('[data-testid="command-palette"]')).toBeNull();
    flushSync(() => {
      type(target, "/");
    });

    expect(paletteKeys(target)).toContain("builtin:tree");
    expect(paletteKeys(target)).toContain("builtin:compact");
    expect(paletteKeys(target)).toContain("prompt:review");
    expect(paletteRow(target, "prompt:review").textContent).toContain("Review the working tree");
    // Built-ins and pi's commands are told apart by their badge.
    expect(paletteRow(target, "builtin:tree").textContent).toContain("built-in");
    expect(paletteRow(target, "prompt:review").textContent).toContain("prompt");
  });

  it("fuzzy-filters the rows by the text after the slash", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(commandsOf([REVIEW]));
    });

    flushSync(() => {
      type(target, "/cmp");
    });
    expect(paletteKeys(target)).toEqual(["builtin:compact"]);

    // A space means arguments have started, so the palette closes rather than covering the text.
    flushSync(() => {
      type(target, "/compact keep");
    });
    expect(target.querySelector('[data-testid="command-palette"]')).toBeNull();
  });

  it("completes a chosen row into the composer without sending it", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(commandsOf([REVIEW]));
    });

    flushSync(() => {
      type(target, "/");
    });
    flushSync(() => {
      paletteRow(target, "prompt:review").click();
    });

    expect(input(target).value).toBe("/review ");
    expect(target.querySelector('[data-testid="command-palette"]')).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("completes the highlighted row on Tab and on Enter, keeping the composer focused", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(commandsOf([REVIEW]));
    });

    // `rv` is a subsequence of `review` only, so the highlighted row is the template.
    flushSync(() => {
      type(target, "/rv");
    });
    const tabEvents: KeyboardEvent[] = [];
    flushSync(() => {
      tabEvents.push(keydown(target, { key: "Tab" }));
    });
    expect(tabEvents[0]?.defaultPrevented).toBe(true);
    expect(input(target).value).toBe("/review ");
    expect(document.activeElement).toBe(input(target));

    flushSync(() => {
      type(target, "/cmp");
    });
    const enterEvents: KeyboardEvent[] = [];
    flushSync(() => {
      enterEvents.push(keydown(target, { key: "Enter" }));
    });
    expect(enterEvents[0]?.defaultPrevented).toBe(true);
    expect(input(target).value).toBe("/compact ");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("refuses a pi TUI-only command and never sends it", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/settings");
    });
    flushSync(() => {
      send(target);
    });

    const error = target.querySelector('[data-testid="composer-error"]');
    expect(error?.textContent).toContain("/settings");
    expect(error?.textContent).toContain("TUI-only");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("sends an unrecognised slash command to pi exactly as written", () => {
    const store = new ClientStore();
    const { target, prompt } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/notacommand");
    });
    flushSync(() => {
      send(target);
    });

    expect(prompt).toHaveBeenCalledWith("/notacommand", [], undefined);
    expect(target.querySelector('[data-testid="composer-error"]')).toBeNull();
  });
});

describe("session commands", () => {
  it("starts a new Session with /new", () => {
    const store = new ClientStore();
    const { target, createSession } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/new");
    });
    flushSync(() => {
      send(target);
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(input(target).value).toBe("");
  });

  it("opens the Session list with /resume", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/resume");
    });
    flushSync(() => {
      send(target);
    });

    expect(target.querySelector('[data-testid="session-drawer"]')).not.toBeNull();
  });

  it("opens the model and thinking pickers with /model and /thinking", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(settingsOf());
    });

    flushSync(() => {
      type(target, "/model");
    });
    flushSync(() => {
      send(target);
    });
    expect(target.querySelector('[data-testid="model-options"]')).not.toBeNull();

    flushSync(() => {
      type(target, "/thinking");
    });
    flushSync(() => {
      send(target);
    });
    expect(target.querySelector('[data-testid="thinking-options"]')).not.toBeNull();
  });

  it("shows the current name with a bare /name and sets a new one with an argument", () => {
    const store = new ClientStore();
    const { target, setSessionName } = mountShell(store);
    store.selectSession({ project: "/workspace", id: SESSION_ID });
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(sessionsOf(SESSION_ID, "Seed session 1"));
    });

    flushSync(() => {
      type(target, "/name");
    });
    flushSync(() => {
      send(target);
    });
    expect(target.querySelector('[data-testid="command-notice"]')?.textContent).toBe(
      "Current session name: Seed session 1",
    );
    expect(setSessionName).not.toHaveBeenCalled();

    flushSync(() => {
      type(target, "/name Renamed from the phone");
    });
    flushSync(() => {
      send(target);
    });
    expect(setSessionName).toHaveBeenCalledWith("Renamed from the phone");
  });

  it("asks for the statistics with /session and renders pi's answer, naming a missing value", () => {
    const store = new ClientStore();
    const { target, getSessionStats } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/session");
    });
    flushSync(() => {
      send(target);
    });
    expect(getSessionStats).toHaveBeenCalledTimes(1);

    flushSync(() => {
      store.receive(statsMessageOf());
    });
    const panel = target.querySelector('[data-testid="session-stats-panel"]');
    expect(panel).not.toBeNull();
    const valueFor = (key: string, root: HTMLElement) =>
      root.querySelector(`[data-stat="${key}"] [data-testid="session-stats-value"]`)?.textContent;
    expect(valueFor("session-id", panel as HTMLElement)).toBe(SESSION_ID);
    expect(valueFor("cost", panel as HTMLElement)).toBe("$0.12");
    // A missing context figure reads as unavailable, never as a zero.
    expect(valueFor("context", panel as HTMLElement)).toBe("unavailable");
  });

  it("ignores command results that name another Session", () => {
    const store = new ClientStore();
    const { target, downloadFile } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      store.receive({
        type: ServerMessageType.SessionStats,
        session: { project: "/other", id: SESSION_ID },
        stats: statsOf(),
      });
      store.receive({
        type: ServerMessageType.SessionExported,
        session: { project: "/workspace", id: "session-other" },
        path: "session-other.html",
      });
      store.receive({
        type: ServerMessageType.SessionRenamed,
        session: { project: "/other", id: SESSION_ID },
        name: "another session",
      });
      store.receive({
        type: ServerMessageType.SessionForked,
        sourceSession: { project: "/other", id: SESSION_ID },
        mutation: "fork",
        session: { project: "/other", id: "session-forked" },
      });
    });

    expect(target.querySelector('[data-testid="session-stats-panel"]')).toBeNull();
    expect(target.querySelector('[data-testid="session-export-path"]')).toBeNull();
    expect(target.querySelector('[data-testid="command-notice"]')).toBeNull();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("downloads pi's exported HTML as the single result of /export", () => {
    const store = new ClientStore();
    const { target, exportSession, downloadFile } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/export");
    });
    flushSync(() => {
      send(target);
    });
    expect(exportSession).toHaveBeenCalledTimes(1);
    expect(downloadFile).not.toHaveBeenCalled();

    // The exported file is written inside the chosen Project, so the download names it.
    flushSync(() => {
      store.receive({ type: ServerMessageType.Projects, projects: ["/workspace"] });
    });
    flushSync(() => {
      store.receive(exportedOf("pi-session-session-1.html"));
    });
    expect(downloadFile).toHaveBeenCalledWith("/workspace", "pi-session-session-1.html");
    expect(target.querySelector('[data-testid="session-export-path"]')?.textContent).toBe(
      "pi-session-session-1.html",
    );
    expect(target.querySelector('[data-testid="session-export-download"]')).toBeNull();
  });
});

describe("the reload built-in", () => {
  it("lists /reload in the palette beside the other built-ins", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/");
    });

    expect(paletteKeys(target)).toContain("builtin:reload");
    expect(paletteRow(target, "builtin:reload").textContent).toContain("built-in");
  });

  it("runs /reload as a built-in and never sends it to the model", () => {
    const store = new ClientStore();
    const { target, prompt, reload } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/reload");
    });
    flushSync(() => {
      send(target);
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    expect(target.querySelector('[data-testid="composer-error"]')).toBeNull();
  });

  it("reloads on /reload with trailing text rather than prompting it", () => {
    const store = new ClientStore();
    const { target, prompt, reload } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/reload now");
    });
    flushSync(() => {
      send(target);
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    expect(input(target).value).toBe("");
  });

  it("reads Reloading… after sending and the confirmation once the reply arrives", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/reload");
    });
    flushSync(() => {
      send(target);
    });

    expect(target.querySelector('[data-testid="command-pending"]')?.textContent).toBe("Reloading…");
    expect(target.querySelector('[data-testid="command-notice"]')).toBeNull();

    flushSync(() => {
      store.receive(reloadedOf());
    });

    expect(target.querySelector('[data-testid="command-pending"]')).toBeNull();
    expect(target.querySelector('[data-testid="command-notice"]')?.textContent).toBe(
      "Reloaded settings, extensions, skills, prompts and context files.",
    );
  });

  it("leaves no Reloading… behind when the reload is refused, and states the refusal", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/reload");
    });
    flushSync(() => {
      send(target);
    });
    expect(target.querySelector('[data-testid="command-pending"]')).not.toBeNull();

    flushSync(() => {
      store.receive(refusedReloadOf("Wait for the current response to finish before reloading."));
    });

    expect(target.querySelector('[data-testid="command-pending"]')).toBeNull();
    expect(target.querySelector('[data-testid="command-notice"]')).toBeNull();
    expect(target.querySelector('[data-testid="composer-error"]')?.textContent).toBe(
      "Wait for the current response to finish before reloading.",
    );
  });

  it("stops reading Reloading… when the connection is not connected", () => {
    const store = new ClientStore();
    const connected = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(connected.target, "/reload");
    });
    flushSync(() => {
      send(connected.target);
    });
    expect(connected.target.querySelector('[data-testid="command-pending"]')).not.toBeNull();

    // A dropped link cannot deliver the reply, so the strip stops claiming the reload is running
    // while the store still remembers that one was sent.
    const dropped = mountShell(store, ConnectionStatus.Reconnecting);
    expect(store.commands.reloadPending).toBe(true);
    expect(dropped.target.querySelector('[data-testid="command-pending"]')).toBeNull();
    expect(dropped.target.querySelector('[data-testid="command-result"]')).toBeNull();
  });

  it("lists the commands the reload re-sent, so a new skill appears without reconnecting", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
      store.receive(commandsOf([REVIEW]));
    });

    flushSync(() => {
      type(target, "/");
    });
    expect(paletteKeys(target)).toContain("prompt:review");
    expect(paletteKeys(target)).not.toContain("skill:reloaded-skill");

    // The reload's own Commands message replaces the palette instead of being ignored as a repeat.
    flushSync(() => {
      store.receive(commandsOf([REVIEW, RELOADED_SKILL]));
    });

    expect(paletteKeys(target)).toContain("skill:reloaded-skill");
  });

  it("does not carry a pending reload into another Session", () => {
    const store = new ClientStore();
    const { target } = mountShell(store);
    flushSync(() => {
      store.receive(snapshotOf([]));
    });

    flushSync(() => {
      type(target, "/reload");
    });
    flushSync(() => {
      send(target);
    });
    expect(target.querySelector('[data-testid="command-pending"]')).not.toBeNull();

    flushSync(() => {
      store.selectSession({ project: "/workspace", id: "session-2" });
    });

    expect(target.querySelector('[data-testid="command-pending"]')).toBeNull();
    expect(target.querySelector('[data-testid="command-result"]')).toBeNull();
  });
});

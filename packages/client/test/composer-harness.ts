import { flushSync, mount, type Component } from "svelte";
import { vi } from "vitest";

import {
  EntryKind,
  ProjectionDeltaKind,
  RunStateKind,
  ServerMessageType,
  ThinkingLevel,
  type DeltaMessage,
  type ProjectedEntry,
  type ProjectionDelta,
  type RunState,
  type SettingsMessage,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

export const SESSION_ID = "session-1";
const IDLE: RunState = { kind: RunStateKind.Idle };

export function snapshotOf(entries: readonly ProjectedEntry[]): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: SESSION_ID,
    cursor: entries.length,
    projection: {
      sessionId: SESSION_ID,
      cwd: "/workspace",
      leafId: entries.at(-1)?.id ?? null,
      entries,
      runState: IDLE,
      subagents: [],
    },
  };
}

export function deltaOf(deltas: readonly ProjectionDelta[], fromCursor: number): DeltaMessage {
  return {
    type: ServerMessageType.Delta,
    sessionId: SESSION_ID,
    fromCursor,
    cursor: fromCursor + deltas.length,
    deltas,
  };
}

export function settingsOf(overrides: Partial<SettingsMessage> = {}): SettingsMessage {
  return {
    type: ServerMessageType.Settings,
    sessionId: SESSION_ID,
    model: { provider: "scripted", id: "scripted", name: "Scripted model", reasoning: true },
    availableModels: [
      { provider: "scripted", id: "scripted", name: "Scripted model", reasoning: true },
      { provider: "scripted", id: "scripted-2", name: "Second model", reasoning: false },
    ],
    thinkingLevel: ThinkingLevel.Low,
    availableThinkingLevels: [ThinkingLevel.Off, ThinkingLevel.Low, ThinkingLevel.High],
    autoCompactionEnabled: true,
    ...overrides,
  };
}

export function userEntry(id: string, text: string): ProjectedEntry {
  return {
    kind: EntryKind.Message,
    id,
    parentId: null,
    role: "user",
    timestamp: 0,
    blocks: [{ type: "text", text }],
  };
}

export interface Mounted {
  readonly target: HTMLElement;
  readonly prompt: ReturnType<typeof vi.fn>;
  readonly bash: ReturnType<typeof vi.fn>;
  readonly abort: ReturnType<typeof vi.fn>;
  readonly setModel: ReturnType<typeof vi.fn>;
  readonly setThinking: ReturnType<typeof vi.fn>;
  readonly setAutoCompaction: ReturnType<typeof vi.fn>;
  readonly compact: ReturnType<typeof vi.fn>;
  readonly setSessionName: ReturnType<typeof vi.fn>;
  readonly getSessionStats: ReturnType<typeof vi.fn>;
  readonly exportSession: ReturnType<typeof vi.fn>;
  readonly createSession: ReturnType<typeof vi.fn>;
  readonly downloadFile: ReturnType<typeof vi.fn>;
  readonly branch: ReturnType<typeof vi.fn>;
  readonly getForkMessages: ReturnType<typeof vi.fn>;
  readonly fork: ReturnType<typeof vi.fn>;
  readonly clone: ReturnType<typeof vi.fn>;
}

export function mountShell(store: ClientStore, status = ConnectionStatus.Connected): Mounted {
  const prompt = vi.fn();
  const bash = vi.fn();
  const abort = vi.fn();
  const setModel = vi.fn();
  const setThinking = vi.fn();
  const setAutoCompaction = vi.fn();
  const compact = vi.fn();
  const setSessionName = vi.fn();
  const getSessionStats = vi.fn();
  const exportSession = vi.fn();
  const createSession = vi.fn();
  const downloadFile = vi.fn();
  const branch = vi.fn();
  const getForkMessages = vi.fn();
  const fork = vi.fn();
  const clone = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status,
        onSelectSession: () => undefined,
        onPrompt: prompt,
        onBash: bash,
        onAbort: abort,
        onSetModel: setModel,
        onSetThinkingLevel: setThinking,
        onSetAutoCompaction: setAutoCompaction,
        onCompact: compact,
        onSetSessionName: setSessionName,
        onGetSessionStats: getSessionStats,
        onExportSession: exportSession,
        onCreateSession: createSession,
        onBranch: branch,
        onGetForkMessages: getForkMessages,
        onFork: fork,
        onClone: clone,
        onListDirectory: () => undefined,
        onPreviewFile: () => undefined,
        onDownloadFile: downloadFile,
      },
    });
  });
  return {
    target,
    prompt,
    bash,
    abort,
    setModel,
    setThinking,
    setAutoCompaction,
    compact,
    setSessionName,
    getSessionStats,
    exportSession,
    createSession,
    downloadFile,
    branch,
    getForkMessages,
    fork,
    clone,
  };
}

export function input(target: HTMLElement): HTMLTextAreaElement {
  const element = target.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
  if (element === null) {
    throw new Error("the composer input is missing");
  }
  return element;
}

export function type(target: HTMLElement, value: string): void {
  const element = input(target);
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function streaming(): readonly ProjectionDelta[] {
  return [{ kind: ProjectionDeltaKind.RunState, runState: { kind: RunStateKind.Streaming } }];
}

export function keydown(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  input(target).dispatchEvent(event);
  return event;
}

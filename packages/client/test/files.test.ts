import { flushSync, mount, type Component } from "svelte";
import { describe, expect, it, vi } from "vitest";

import {
  FileEntryType,
  ServerMessageType,
  type DirectoryEntry,
  type DirectoryListingMessage,
  type ErrorMessage,
  type FilePreviewMessage,
  type ProjectedEntry,
  type SnapshotMessage,
} from "@pi-my-ui/protocol";

import Shell from "../src/lib/Shell.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

function snapshotOf(entries: readonly ProjectedEntry[]): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    sessionId: "session-1",
    cursor: entries.length,
    projection: {
      sessionId: "session-1",
      cwd: "/workspace",
      leafId: null,
      entries,
      runState: { kind: "idle" },
      subagents: [],
      subagentTranscripts: [],
    },
  };
}

function entry(
  name: string,
  type: DirectoryEntry["type"],
  size: number | null = null,
): DirectoryEntry {
  return { name, type, size, mtimeMs: null };
}

function listingOf(path: string, entries: readonly DirectoryEntry[]): DirectoryListingMessage {
  return { type: ServerMessageType.DirectoryListing, path, entries };
}

function previewOf(
  path: string,
  text: string,
  size: number,
  truncated: boolean,
): FilePreviewMessage {
  return { type: ServerMessageType.FilePreview, path, text, size, truncated };
}

function fileErrorOf(detail: string, message: string): ErrorMessage {
  return {
    type: ServerMessageType.Error,
    error: { code: "pathEscape", message, detail },
  };
}

interface Mounted {
  readonly target: HTMLElement;
  readonly listDirectory: ReturnType<typeof vi.fn>;
  readonly previewFile: ReturnType<typeof vi.fn>;
  readonly downloadFile: ReturnType<typeof vi.fn>;
}

function mountShell(store: ClientStore): Mounted {
  const listDirectory = vi.fn();
  const previewFile = vi.fn();
  const downloadFile = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  flushSync(() => {
    mount(Shell as Component<Record<string, unknown>>, {
      target,
      props: {
        store,
        status: ConnectionStatus.Connected,
        onPrompt: () => undefined,
        onAbort: () => undefined,
        onListDirectory: listDirectory,
        onPreviewFile: previewFile,
        onDownloadFile: downloadFile,
      },
    });
  });
  return { target, listDirectory, previewFile, downloadFile };
}

/** Open the panel and hand it a root listing with one directory and one file. */
function openTree(store: ClientStore, mounted: Mounted): void {
  flushSync(() => {
    store.receive(snapshotOf([]));
  });
  flushSync(() => {
    mounted.target.querySelector<HTMLElement>('[data-testid="files-toggle"]')?.click();
  });
  flushSync(() => {
    store.receive(
      listingOf("", [
        entry("src", FileEntryType.Directory),
        entry("README.md", FileEntryType.File, 12),
      ]),
    );
  });
}

function rows(mounted: Mounted, testId: string): HTMLElement[] {
  return [...mounted.target.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
}

describe("the file tree", () => {
  it("renders the root listing with directories first and fetches only the root", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    expect(mounted.listDirectory.mock.calls).toEqual([[""]]);
    expect(rows(mounted, "file-tree-directory").map((row) => row.dataset["path"])).toEqual(["src"]);
    expect(rows(mounted, "file-tree-file").map((row) => row.dataset["path"])).toContain(
      "README.md",
    );
    expect(mounted.target.querySelector('[data-testid="file-tree-cwd"]')?.textContent).toBe(
      "/workspace",
    );
  });

  it("fetches a directory's children only when it is expanded", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      rows(mounted, "file-tree-directory")[0]?.click();
    });
    expect(mounted.listDirectory.mock.calls).toEqual([[""], ["src"]]);

    flushSync(() => {
      store.receive(listingOf("src", [entry("index.ts", FileEntryType.File, 3)]));
    });
    expect(rows(mounted, "file-tree-file").map((row) => row.dataset["path"])).toContain(
      "src/index.ts",
    );
  });

  it("downloads a file when its row is tapped", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      rows(mounted, "file-tree-file")[0]?.click();
    });
    expect(mounted.downloadFile).toHaveBeenCalledWith("README.md");
  });

  it("states that a preview was truncated", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      rows(mounted, "file-tree-preview")[0]?.click();
    });
    expect(mounted.previewFile).toHaveBeenCalledWith("README.md");

    flushSync(() => {
      store.receive(previewOf("README.md", "the whole file", 90_000, true));
    });
    expect(mounted.target.querySelector('[data-testid="file-preview-text"]')?.textContent).toBe(
      "the whole file",
    );
    expect(
      mounted.target.querySelector('[data-testid="file-preview-truncated"]')?.textContent,
    ).toContain("truncated");

    flushSync(() => {
      store.receive(previewOf("README.md", "a small file", 12, false));
    });
    expect(mounted.target.querySelector('[data-testid="file-preview-truncated"]')).toBeNull();
  });

  it("shows a refused listing as a failure, never as an empty directory", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      rows(mounted, "file-tree-directory")[0]?.click();
      store.receive(fileErrorOf("src", 'path "src" escapes the served working directory'));
    });
    const failure = mounted.target.querySelector('[data-testid="file-tree-node-error"]');
    expect(failure?.textContent).toContain("escapes the served working directory");
  });
});

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

import { fileDownloadUrl } from "../src/lib/files/download.js";
import Shell from "../src/lib/Shell.svelte";
import { ConnectionStatus } from "../src/lib/transport.js";
import { ClientStore } from "../src/lib/store/client-store.svelte.js";

const PROJECT = "/workspace";
const OTHER_PROJECT = "/other-project";

function snapshotOf(entries: readonly ProjectedEntry[]): SnapshotMessage {
  return {
    type: ServerMessageType.Snapshot,
    session: { project: PROJECT, id: "session-1" },
    cursor: entries.length,
    projection: {
      sessionId: "session-1",
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

function listingOf(
  project: string,
  path: string,
  entries: readonly DirectoryEntry[],
): DirectoryListingMessage {
  return { type: ServerMessageType.DirectoryListing, project, path, entries };
}

function previewOf(
  project: string,
  path: string,
  text: string,
  size: number,
  truncated: boolean,
): FilePreviewMessage {
  return { type: ServerMessageType.FilePreview, project, path, text, size, truncated };
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
function openTree(
  store: ClientStore,
  mounted: Mounted,
  projects: readonly string[] = [PROJECT],
): void {
  flushSync(() => {
    store.receive({ type: ServerMessageType.Projects, projects, workspace: null });
    store.receive(snapshotOf([]));
  });
  flushSync(() => {
    toggleFiles(mounted);
  });
  flushSync(() => {
    store.receive(
      listingOf(PROJECT, "", [
        entry("src", FileEntryType.Directory),
        entry("README.md", FileEntryType.File, 12),
      ]),
    );
  });
}

function toggleFiles(mounted: Mounted): void {
  mounted.target.querySelector<HTMLElement>('[data-testid="files-toggle"]')?.click();
}

function rows(mounted: Mounted, testId: string): HTMLElement[] {
  return [...mounted.target.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
}

function rootLabel(mounted: Mounted): string | null | undefined {
  return mounted.target.querySelector('[data-testid="file-tree-root"]')?.textContent;
}

describe("the file tree", () => {
  it("renders the root listing with directories first and fetches only the root", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    expect(mounted.listDirectory.mock.calls).toEqual([[PROJECT, ""]]);
    expect(rows(mounted, "file-tree-directory").map((row) => row.dataset["path"])).toEqual(["src"]);
    expect(rows(mounted, "file-tree-file").map((row) => row.dataset["path"])).toContain(
      "README.md",
    );
    expect(rootLabel(mounted)).toBe(PROJECT);
  });

  it("fetches a directory's children only when it is expanded", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      rows(mounted, "file-tree-directory")[0]?.click();
    });
    expect(mounted.listDirectory.mock.calls).toEqual([
      [PROJECT, ""],
      [PROJECT, "src"],
    ]);

    flushSync(() => {
      store.receive(listingOf(PROJECT, "src", [entry("index.ts", FileEntryType.File, 3)]));
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
    expect(mounted.downloadFile).toHaveBeenCalledWith(PROJECT, "README.md");
  });

  it("states that a preview was truncated", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      rows(mounted, "file-tree-preview")[0]?.click();
    });
    expect(mounted.previewFile).toHaveBeenCalledWith(PROJECT, "README.md");

    flushSync(() => {
      store.receive(previewOf(PROJECT, "README.md", "the whole file", 90_000, true));
    });
    expect(mounted.target.querySelector('[data-testid="file-preview-text"]')?.textContent).toBe(
      "the whole file",
    );
    expect(
      mounted.target.querySelector('[data-testid="file-preview-truncated"]')?.textContent,
    ).toContain("truncated");

    flushSync(() => {
      store.receive(previewOf(PROJECT, "README.md", "a small file", 12, false));
    });
    expect(mounted.target.querySelector('[data-testid="file-preview-truncated"]')).toBeNull();
  });

  it("shows a refused listing as a failure, never as an empty directory", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      rows(mounted, "file-tree-directory")[0]?.click();
      store.receive(fileErrorOf("src", 'path "src" escapes the Project root'));
    });
    const failure = mounted.target.querySelector('[data-testid="file-tree-node-error"]');
    expect(failure?.textContent).toContain("escapes the Project root");
  });
});

describe("the file tree's Project", () => {
  it("never renders a listing that belongs to another Project", () => {
    const store = new ClientStore();
    const mounted = mountShell(store);
    openTree(store, mounted);

    flushSync(() => {
      store.receive(listingOf(OTHER_PROJECT, "", [entry("secret.txt", FileEntryType.File, 5)]));
    });
    expect(rows(mounted, "file-tree-file")).toHaveLength(1);
    expect(rows(mounted, "file-tree-file")[0]?.textContent).not.toContain("secret.txt");
  });

  it("re-roots at the newly chosen Project and forgets the previous tree", () => {
    const store = new ClientStore(PROJECT);
    const mounted = mountShell(store);
    openTree(store, mounted, [PROJECT, OTHER_PROJECT]);

    flushSync(() => {
      store.selectProject(OTHER_PROJECT);
    });
    // The panel named the Project it was opened for, so a different choice closes it.
    expect(mounted.target.querySelector('[data-testid="file-tree"]')).toBeNull();

    flushSync(() => {
      toggleFiles(mounted);
    });
    expect(mounted.listDirectory.mock.calls.at(-1)).toEqual([OTHER_PROJECT, ""]);

    flushSync(() => {
      store.receive(listingOf(OTHER_PROJECT, "", [entry("notes.md", FileEntryType.File, 4)]));
    });
    expect(rootLabel(mounted)).toBe(OTHER_PROJECT);
    expect(rows(mounted, "file-tree-file").map((row) => row.dataset["path"])).toEqual(["notes.md"]);
  });
});

describe("a download URL", () => {
  it("names both the Project and the path relative to it", () => {
    const url = new URL(fileDownloadUrl("ws://phone.local:1234/ws", PROJECT, "src/index.ts"));

    expect(url.origin).toBe("http://phone.local:1234");
    expect(url.pathname).toBe("/files/download");
    expect(url.searchParams.get("project")).toBe(PROJECT);
    expect(url.searchParams.get("path")).toBe("src/index.ts");
  });
});

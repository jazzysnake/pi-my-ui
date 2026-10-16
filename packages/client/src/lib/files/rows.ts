/**
 * The file tree's row model — pure, so it is tested without a component. It flattens the listings the
 * store holds into the rows visible right now: the root's entries, then the entries of every expanded
 * directory, in order. A directory that is not expanded contributes no children, so a directory's
 * children exist only after the user asked for it.
 */

import { FileEntryType, type DirectoryEntry } from "@pi-my-ui/protocol";

import type { FilesSlice } from "../store/files.svelte.js";

/** The relative path of the served root in a listing request. */
export const ROOT_PATH = "";

/** One entry the tree renders. */
export interface FileTreeRow {
  /** The path relative to the served root, used for requests and as the identity of the row. */
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly entry: DirectoryEntry;
  readonly expanded: boolean;
  /** The failure a listing of this directory received, or `null`. */
  readonly failure: string | null;
  /** True while the directory is expanded and its listing has not arrived. */
  readonly loading: boolean;
}

/** The child path of `parent` (`ROOT_PATH` for the root) and one entry name. */
export function joinPath(parent: string, name: string): string {
  return parent === ROOT_PATH ? name : `${parent}/${name}`;
}

/** Flatten the tree to the rows visible right now. */
export function visibleRows(
  files: FilesSlice,
  expanded: Readonly<Record<string, boolean>>,
  rootPath: string = ROOT_PATH,
): readonly FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  collect(files, expanded, rootPath, 0, rows);
  return rows;
}

function collect(
  files: FilesSlice,
  expanded: Readonly<Record<string, boolean>>,
  parentPath: string,
  depth: number,
  out: FileTreeRow[],
): void {
  const listing = files.listingFor(parentPath);
  if (listing === undefined) {
    return;
  }
  for (const entry of listing.entries) {
    const path = joinPath(parentPath, entry.name);
    const isDirectory = entry.type === FileEntryType.Directory;
    const failure = files.failureFor(path) ?? null;
    const isExpanded = isDirectory && expanded[path] === true;
    out.push({
      path,
      name: entry.name,
      depth,
      entry,
      expanded: isExpanded,
      failure,
      loading: isExpanded && failure === null && files.listingFor(path) === undefined,
    });
    if (isExpanded) {
      collect(files, expanded, path, depth + 1, out);
    }
  }
}

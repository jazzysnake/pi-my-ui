/**
 * Directory listing. A filesystem read, not Session state: it produces one message and touches no
 * Cursor and no Delta.
 *
 * Two properties are deliberate:
 *   - directories first, then case-insensitive name, compared by code unit rather than
 *     `localeCompare`, so the order is identical on every machine and a test can assert a literal.
 *   - entry metadata comes from `lstat`, never a followed `stat`, so a symlink's size and mtime
 *     describe the link and can never leak metadata from outside the root.
 */

import { lstatSync, readdirSync, statSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { join } from "node:path";

import { FileEntryType, type DirectoryEntry } from "@pi-my-ui/protocol";

import {
  isPermissionError,
  PathNotFoundError,
  PathNotDirectoryError,
  PathPermissionError,
} from "./errors.js";
import { resolvePath } from "./path-safety.js";

/** Directories before everything else, then by case-insensitive name, then by exact spelling. */
export function compareEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  const aDirectory = a.type === FileEntryType.Directory;
  const bDirectory = b.type === FileEntryType.Directory;
  if (aDirectory !== bDirectory) {
    return aDirectory ? -1 : 1;
  }
  const aFolded = a.name.toLowerCase();
  const bFolded = b.name.toLowerCase();
  if (aFolded !== bFolded) {
    return aFolded < bFolded ? -1 : 1;
  }
  if (a.name === b.name) {
    return 0;
  }
  return a.name < b.name ? -1 : 1;
}

/**
 * List one directory of `root`. `requested` is relative to `root`, with `""` for the root itself.
 * Returns the normalized relative path alongside the sorted entries, so a client can match the answer
 * to the node it expanded.
 */
export function listDirectory(
  root: string,
  requested: string,
): { readonly path: string; readonly entries: readonly DirectoryEntry[] } {
  const resolved = resolvePath(root, requested);

  let stats: Stats;
  try {
    // The path was just realpath'd, so it is not a symlink here; `stat` is the directory check.
    stats = statSync(resolved.absolute);
  } catch {
    // The realpath succeeded, so the target existed a moment ago; it vanished before the stat.
    throw new PathNotFoundError(requested);
  }
  if (!stats.isDirectory()) {
    throw new PathNotDirectoryError(requested);
  }

  let dirents: readonly Dirent[];
  try {
    dirents = readdirSync(resolved.absolute, { withFileTypes: true });
  } catch (error) {
    if (isPermissionError(error)) {
      throw new PathPermissionError(requested);
    }
    throw error;
  }

  const entries = dirents.map((dirent) => entryOf(resolved.absolute, dirent));
  entries.sort(compareEntries);
  return { path: resolved.relative, entries };
}

/** One entry from its `Dirent` and an `lstat` of the entry itself (never its target). */
function entryOf(directory: string, dirent: Dirent): DirectoryEntry {
  try {
    const stats = lstatSync(join(directory, dirent.name));
    return {
      name: dirent.name,
      type: typeOf(stats.isSymbolicLink(), stats.isDirectory(), stats.isFile()),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    // Listed by name but not examinable: keep the entry with unknown metadata rather than fail the
    // whole listing or invent a zero.
    return {
      name: dirent.name,
      type: typeOf(dirent.isSymbolicLink(), dirent.isDirectory(), dirent.isFile()),
      size: null,
      mtimeMs: null,
    };
  }
}

function typeOf(symlink: boolean, directory: boolean, file: boolean): FileEntryType {
  if (symlink) {
    return FileEntryType.Symlink;
  }
  if (directory) {
    return FileEntryType.Directory;
  }
  if (file) {
    return FileEntryType.File;
  }
  return FileEntryType.Other;
}

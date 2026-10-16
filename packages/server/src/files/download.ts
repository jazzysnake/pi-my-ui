/**
 * Resolving a download target and streaming it. Path safety is not re-derived here: every request
 * goes through {@link resolvePath}, so the traversal, symlink and absolute-path rules exist once and
 * the listing and the download cannot drift.
 *
 * The object kind is checked before any bytes are promised, so a directory, a missing file or an
 * unreadable file is a typed refusal rather than a zero-byte success.
 */

import { accessSync, constants as fsConstants, createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import type { Readable } from "node:stream";

import { contentTypeForName } from "@pi-my-ui/protocol";

import {
  isNotFoundError,
  PathIsDirectoryError,
  PathNotAFileError,
  PathNotFoundError,
  PathPermissionError,
} from "./errors.js";
import { resolvePath } from "./path-safety.js";

/** A request that resolved to a readable regular file inside the root. */
export interface FileTarget {
  readonly requested: string;
  readonly relative: string;
  readonly absolute: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** Resolve `requested` to a readable regular file, or throw a typed refusal. */
export function openFileTarget(root: string, requested: string): FileTarget {
  const resolved = resolvePath(root, requested);

  let stats;
  try {
    stats = statSync(resolved.absolute);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new PathNotFoundError(requested);
    }
    // A denial here (a parent directory not searchable) is a permission refusal; anything else is
    // still refused rather than opened.
    throw new PathPermissionError(requested);
  }
  if (stats.isDirectory()) {
    throw new PathIsDirectoryError(requested);
  }
  if (!stats.isFile()) {
    throw new PathNotAFileError(requested);
  }
  try {
    accessSync(resolved.absolute, fsConstants.R_OK);
  } catch {
    throw new PathPermissionError(requested);
  }

  const name = basename(resolved.absolute);
  return {
    requested,
    relative: resolved.relative,
    absolute: resolved.absolute,
    name,
    size: stats.size,
    contentType: contentTypeForName(name),
  };
}

/** A readable stream of the whole file. The route pipes it; nothing buffers it here. */
export function streamFile(target: FileTarget): Readable {
  return createReadStream(target.absolute);
}

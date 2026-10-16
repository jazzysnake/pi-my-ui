/**
 * Bounded text previews. A preview is read through the same target resolution and path safety as a
 * download, then refused outright for a name that is not text-like, so a preview never becomes an
 * `application/octet-stream` the browser would render as garbage.
 *
 * The read is bounded before any allocation: the buffer is `min(size, PREVIEW_MAX_BYTES)` bytes, so a
 * huge file cannot be pulled into memory by a preview request. When the file is larger, the result
 * says so — truncation is stated, never silent.
 */

import { closeSync, openSync, readSync } from "node:fs";

import { PREVIEW_MAX_BYTES, isPreviewableName } from "@pi-my-ui/protocol";

import { openFileTarget } from "./download.js";
import {
  isNotFoundError,
  PathNotFoundError,
  PathNotPreviewableError,
  PathPermissionError,
} from "./errors.js";

/** A bounded preview of one text-like file. */
export interface FilePreviewPayload {
  readonly path: string;
  readonly text: string;
  /** The file's full size in bytes. */
  readonly size: number;
  /** True when `text` is a prefix of a larger file. */
  readonly truncated: boolean;
}

/** Read at most {@link PREVIEW_MAX_BYTES} bytes of a text-like file and decode them as UTF-8. */
export function readPreview(root: string, requested: string): FilePreviewPayload {
  const target = openFileTarget(root, requested);
  if (!isPreviewableName(target.name)) {
    throw new PathNotPreviewableError(requested);
  }
  const limit = Math.min(target.size, PREVIEW_MAX_BYTES);
  return {
    path: target.relative,
    text: new TextDecoder("utf-8").decode(readBounded(target.absolute, limit, requested)),
    size: target.size,
    truncated: target.size > PREVIEW_MAX_BYTES,
  };
}

/** Read exactly `length` bytes (or to EOF) from the head of `path`, never more. */
function readBounded(path: string, length: number, requested: string): Uint8Array {
  let descriptor: number;
  try {
    descriptor = openSync(path, "r");
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new PathNotFoundError(requested);
    }
    throw new PathPermissionError(requested);
  }
  try {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const read = readSync(descriptor, buffer, offset, length - offset, offset);
      if (read === 0) {
        break;
      }
      offset += read;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}

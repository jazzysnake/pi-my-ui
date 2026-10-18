/**
 * Typed failures for the file capability, so the listing, the preview and the download route refuse
 * with a class rather than a message string. Every one is a {@link ProtocolError} subclass, so the
 * WebSocket transport's existing error mapping carries its code and requested path on the wire.
 */

import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

/** Base class for the file capability's failures, distinguishing ours from unrelated `Error`s. */
export class FileAccessError extends ProtocolError {
  public constructor(code: ProtocolErrorCode, message: string, detail: string) {
    super(code, message, detail);
    this.name = "FileAccessError";
  }
}

/** The requested path escapes the served root: traversal, an absolute path, or a symlink out. */
export class PathEscapeError extends FileAccessError {
  public constructor(requested: string, rule: string) {
    super(
      ProtocolErrorCode.PathEscape,
      `path ${JSON.stringify(requested)} escapes the Project root: ${rule}`,
      requested,
    );
    this.name = "PathEscapeError";
  }
}

/** The requested path does not exist under the root (a race, or a vanished entry). */
export class PathNotFoundError extends FileAccessError {
  public constructor(requested: string) {
    super(
      ProtocolErrorCode.InternalError,
      `path ${JSON.stringify(requested)} does not exist`,
      requested,
    );
    this.name = "PathNotFoundError";
  }
}

/** The requested path exists but is not a directory, so it cannot be listed. */
export class PathNotDirectoryError extends FileAccessError {
  public constructor(requested: string) {
    super(
      ProtocolErrorCode.InternalError,
      `path ${JSON.stringify(requested)} is not a directory`,
      requested,
    );
    this.name = "PathNotDirectoryError";
  }
}

/** The requested download target is a directory. */
export class PathIsDirectoryError extends FileAccessError {
  public constructor(requested: string) {
    super(
      ProtocolErrorCode.InternalError,
      `path ${JSON.stringify(requested)} is a directory, not a file`,
      requested,
    );
    this.name = "PathIsDirectoryError";
  }
}

/** The requested download target exists but is not a regular file (a FIFO, socket or device node). */
export class PathNotAFileError extends FileAccessError {
  public constructor(requested: string) {
    super(
      ProtocolErrorCode.InternalError,
      `path ${JSON.stringify(requested)} is not a regular file`,
      requested,
    );
    this.name = "PathNotAFileError";
  }
}

/** The requested preview target's type is not text-like, so there is nothing to render as text. */
export class PathNotPreviewableError extends FileAccessError {
  public constructor(requested: string) {
    super(
      ProtocolErrorCode.InternalError,
      `path ${JSON.stringify(requested)} is not a text-like file and cannot be previewed`,
      requested,
    );
    this.name = "PathNotPreviewableError";
  }
}

/** The target is readable by name but not by this process (`EACCES`/`EPERM`). */
export class PathPermissionError extends FileAccessError {
  public constructor(requested: string) {
    super(
      ProtocolErrorCode.InternalError,
      `path ${JSON.stringify(requested)} could not be read: permission denied`,
      requested,
    );
    this.name = "PathPermissionError";
  }
}

/** True for a filesystem error caused by denied access rather than a missing path. */
export function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM";
}

/** True for a filesystem error caused by a path component that does not exist. */
export function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * The download route: `POST /files/download?path=…` streams one file with
 * `Content-Disposition: attachment`, so the phone's normal download flow handles it.
 *
 * It is a POST rather than a GET because the origin allowlist is checked on this route exactly as it
 * is on the WebSocket upgrade, and a same-origin browser navigation carries no `Origin` while a form
 * POST does. The check is origin/peer only — a CSRF-shaped guard, not authentication.
 *
 * The response is a stream, never a buffer, so a large file does not become a large allocation. Every
 * refusal is a distinct status: an escape or a permission failure is a bodyless 403 that echoes
 * nothing about the server's filesystem, a missing path is a 404, a wrong object kind is a 400.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { FILE_DOWNLOAD_PATH, FILE_PATH_PARAM } from "@pi-my-ui/protocol";

import type { TrustPolicy } from "../origin.js";
import { openFileTarget, streamFile } from "./download.js";
import {
  FileAccessError,
  PathEscapeError,
  PathIsDirectoryError,
  PathNotAFileError,
  PathNotFoundError,
  PathPermissionError,
} from "./errors.js";

/** The one HTTP method the download route accepts. */
export const FILE_DOWNLOAD_METHOD = "POST";

/** The fallback `filename` when a name reduces to nothing printable, since a header must not be empty. */
const DISPOSITION_ASCII_FALLBACK = "file";

export interface FileRouteOptions {
  /** The served root: one server serves one working directory, so this is the one root. */
  readonly cwd: string;
  readonly trust: TrustPolicy;
  readonly log: (line: string) => void;
}

/** Hex-escape one character for the RFC 5987 `filename*` value. */
function percentHex(character: string): string {
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
}

/**
 * A `Content-Disposition` header value for `name`, carrying both a quoted ASCII `filename` and the
 * RFC 5987 `filename*` form. A name comes from the working tree, so control characters are stripped:
 * a raw CR/LF would be header injection.
 */
export function contentDisposition(name: string): string {
  const safe = name.replace(/[\r\n]/g, "");
  const ascii =
    safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || DISPOSITION_ASCII_FALLBACK;
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, percentHex);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** True when `pathname` is the download route. */
export function isFileDownloadPath(pathname: string): boolean {
  return pathname === FILE_DOWNLOAD_PATH;
}

/** The status a typed refusal maps to. */
function statusFor(error: FileAccessError): number {
  if (error instanceof PathEscapeError || error instanceof PathPermissionError) {
    return 403;
  }
  if (error instanceof PathNotFoundError) {
    return 404;
  }
  if (error instanceof PathIsDirectoryError || error instanceof PathNotAFileError) {
    return 400;
  }
  return 500;
}

/** The two security refusals are bodyless, so nothing about the server's filesystem is echoed back. */
function isBodylessRefusal(status: number): boolean {
  return status === 403 || status === 500;
}

function requestedPath(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? "/", "http://localhost");
  const value = url.searchParams.get(FILE_PATH_PARAM);
  return value === null ? undefined : value;
}

/** Answer one download request, or refuse it. Never leaves the response open. */
export function handleFileDownload(
  request: IncomingMessage,
  response: ServerResponse,
  options: FileRouteOptions,
): void {
  if (request.method !== FILE_DOWNLOAD_METHOD) {
    response.writeHead(405, { allow: FILE_DOWNLOAD_METHOD });
    response.end();
    return;
  }

  const origin = request.headers.origin;
  const decision = options.trust.decide({
    origin: origin === undefined || origin === "" ? undefined : origin,
    peerAddress: request.socket.remoteAddress,
  });
  if (!decision.allowed) {
    options.log(`files: refused download: ${decision.reason}`);
    response.writeHead(403);
    response.end();
    return;
  }

  const requested = requestedPath(request);
  if (requested === undefined) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end(`missing required query parameter: ${FILE_PATH_PARAM}`);
    return;
  }

  let target;
  try {
    target = openFileTarget(options.cwd, requested);
  } catch (error) {
    if (error instanceof FileAccessError) {
      const status = statusFor(error);
      options.log(`files: refused download of ${JSON.stringify(requested)}: ${error.message}`);
      if (isBodylessRefusal(status)) {
        response.writeHead(status);
        response.end();
        return;
      }
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
      return;
    }
    options.log(
      `files: unexpected download failure: ${error instanceof Error ? error.message : String(error)}`,
    );
    response.writeHead(500);
    response.end();
    return;
  }

  response.writeHead(200, {
    "content-type": target.contentType,
    "content-disposition": contentDisposition(target.name),
    "content-length": String(target.size),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const stream = streamFile(target);
  // A stream that fails mid-response cannot change the status already sent; destroying the socket is
  // the only honest signal that the body is incomplete.
  stream.on("error", (error: Error) => {
    options.log(`files: download stream failed: ${error.message}`);
    response.destroy();
  });
  stream.pipe(response);
}

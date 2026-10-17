/**
 * The bridge socket's filesystem lifecycle: a user-only directory and inode, a bind that replaces a
 * stale socket left by a crash, and removal on shutdown.
 *
 * The OS owns the first gate on the socket: only the user may enter the directory or connect to the
 * inode, so another user on the machine cannot reach the bridge at all.
 */

import { chmodSync, mkdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { createConnection, type Server } from "node:net";
import { dirname } from "node:path";

import { errorText } from "../error-text.js";
import { BridgeSocketError } from "./errors.js";

/** Only the user may enter the bridge's per-run directory. */
export const BRIDGE_SOCKET_DIR_MODE = 0o700;
/** The socket inode is user-only too; `listen` creates it with the umask. */
export const BRIDGE_SOCKET_MODE = 0o600;
/** How long a stale-socket probe waits before it reports the socket as live. */
export const BRIDGE_STALE_SOCKET_PROBE_TIMEOUT_MS = 1_000;

function isErrnoWithCode(error: unknown, codes: readonly string[]): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && codes.includes(code);
}

/** Listen once, rejecting with the raw error so the caller can classify it. */
function listenOnce(server: Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

/** Probe whether something is already accepting connections on the path. */
async function socketIsLive(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new BridgeSocketError(
          socketPath,
          `could not determine whether a live server owns the socket within ` +
            `${String(BRIDGE_STALE_SOCKET_PROBE_TIMEOUT_MS)}ms`,
        ),
      );
    }, BRIDGE_STALE_SOCKET_PROBE_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Bind the socket, handling a stale one left by a crashed server: if the path exists but nothing
 * answers, remove it and bind; if something answers, refuse rather than clobber a live peer.
 */
async function bindBridgeSocket(server: Server, socketPath: string): Promise<void> {
  try {
    await listenOnce(server, socketPath);
    return;
  } catch (error) {
    if (!isErrnoWithCode(error, ["EADDRINUSE"])) {
      throw new BridgeSocketError(socketPath, `could not listen: ${errorText(error)}`, {
        cause: error,
      });
    }
    if (await socketIsLive(socketPath)) {
      throw new BridgeSocketError(
        socketPath,
        "another process is already listening here; refusing to replace it",
      );
    }
    try {
      unlinkSync(socketPath);
    } catch (unlinkError) {
      throw new BridgeSocketError(
        socketPath,
        `removing the stale socket failed: ${errorText(unlinkError)}`,
        { cause: unlinkError },
      );
    }
    try {
      await listenOnce(server, socketPath);
    } catch (retryError) {
      throw new BridgeSocketError(
        socketPath,
        `could not listen after removing the stale socket: ${errorText(retryError)}`,
        { cause: retryError },
      );
    }
  }
}

function modeText(mode: number): string {
  return `0o${mode.toString(8)}`;
}

function readDirectoryMode(socketPath: string, directory: string): number {
  try {
    return statSync(directory).mode & 0o777;
  } catch (error) {
    throw new BridgeSocketError(
      socketPath,
      `could not inspect the socket directory ${JSON.stringify(directory)}: ${errorText(error)}`,
      { cause: error },
    );
  }
}

/**
 * `mkdirSync` mode applies only to a directory it creates and is masked by the umask, so an existing
 * directory is tightened and verified; one that cannot be tightened fails loudly rather than
 * exposing the socket.
 */
function ensureSocketDirectory(socketPath: string): void {
  const directory = dirname(socketPath);
  try {
    mkdirSync(directory, { recursive: true, mode: BRIDGE_SOCKET_DIR_MODE });
  } catch (error) {
    throw new BridgeSocketError(
      socketPath,
      `could not create the socket directory: ${errorText(error)}`,
      { cause: error },
    );
  }
  const current = readDirectoryMode(socketPath, directory);
  if (current === BRIDGE_SOCKET_DIR_MODE) {
    return;
  }
  try {
    chmodSync(directory, BRIDGE_SOCKET_DIR_MODE);
  } catch (error) {
    throw new BridgeSocketError(
      socketPath,
      `socket directory ${JSON.stringify(directory)} is mode ${modeText(current)} and could not be ` +
        `tightened to ${modeText(BRIDGE_SOCKET_DIR_MODE)}: ${errorText(error)}`,
      { cause: error },
    );
  }
  const tightened = readDirectoryMode(socketPath, directory);
  if (tightened !== BRIDGE_SOCKET_DIR_MODE) {
    throw new BridgeSocketError(
      socketPath,
      `socket directory ${JSON.stringify(directory)} is mode ${modeText(tightened)} after ` +
        `tightening; refusing to bind a socket in it`,
    );
  }
}

/** `listen` creates the inode with the umask, so tighten it and verify the result. */
function secureSocketMode(socketPath: string): void {
  try {
    chmodSync(socketPath, BRIDGE_SOCKET_MODE);
  } catch (error) {
    throw new BridgeSocketError(
      socketPath,
      `could not tighten the socket to ${modeText(BRIDGE_SOCKET_MODE)}: ${errorText(error)}`,
      { cause: error },
    );
  }
  const mode = statSync(socketPath).mode & 0o777;
  if (mode !== BRIDGE_SOCKET_MODE) {
    throw new BridgeSocketError(
      socketPath,
      `socket is mode ${modeText(mode)} after tightening; refusing to accept connections on it`,
    );
  }
}

/** Create the user-only directory, bind, and secure the inode. */
export async function bindAndSecureSocket(server: Server, socketPath: string): Promise<void> {
  ensureSocketDirectory(socketPath);
  await bindBridgeSocket(server, socketPath);
  secureSocketMode(socketPath);
}

/** Remove the socket and its per-run directory, tolerating either already being gone. */
export function removeBridgeSocket(socketPath: string): void {
  try {
    unlinkSync(socketPath);
  } catch (error) {
    if (!isErrnoWithCode(error, ["ENOENT"])) {
      throw new BridgeSocketError(
        socketPath,
        `could not remove the socket on shutdown: ${errorText(error)}`,
        { cause: error },
      );
    }
  }
  try {
    rmdirSync(dirname(socketPath));
  } catch (error) {
    if (!isErrnoWithCode(error, ["ENOENT", "ENOTEMPTY", "EEXIST"])) {
      throw new BridgeSocketError(
        socketPath,
        `could not remove the socket directory on shutdown: ${errorText(error)}`,
        { cause: error },
      );
    }
  }
}

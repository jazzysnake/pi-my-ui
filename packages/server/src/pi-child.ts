/**
 * One Pi child for one Session file, reached through pi's own RPC client. The server never speaks
 * pi's JSONL protocol itself, so every command it uses is the one pi documents.
 */

import { join } from "node:path";

import { getPackageDir, RpcClient, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { PiLaunchOptions } from "./config.js";

export interface PiChildLaunch extends PiLaunchOptions {
  readonly cwd: string;
}

export interface PiEntries {
  readonly entries: readonly SessionEntry[];
  readonly leafId: string | null;
}

export interface PiChild {
  entries(): Promise<PiEntries>;
  stop(): Promise<void>;
}

/** Start a real `pi --mode rpc` child on `sessionFile` and wait until it is running. */
export async function startPiChild(sessionFile: string, launch: PiChildLaunch): Promise<PiChild> {
  const client = new RpcClient({
    cwd: launch.cwd,
    cliPath: launch.cliPath ?? join(getPackageDir(), "dist", "cli.js"),
    args: [...(launch.args ?? []), "--session", sessionFile],
    ...(launch.env === undefined ? {} : { env: { ...launch.env } }),
    ...(launch.provider === undefined ? {} : { provider: launch.provider }),
    ...(launch.model === undefined ? {} : { model: launch.model }),
  });
  await client.start();
  return {
    entries: () => client.getEntries(),
    stop: () => client.stop(),
  };
}

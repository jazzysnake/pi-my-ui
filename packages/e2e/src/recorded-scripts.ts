import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScript, type Script } from "@pi-my-ui/scripted-provider";

/** Where `npm run rerecord` writes the recordings the scripted provider replays. */
export const RECORDED_SCRIPTS_DIR = fileURLToPath(
  new URL("../../scripted-provider/scripts/", import.meta.url),
);

export async function loadRecordedScript(name: string): Promise<Script> {
  const path = join(RECORDED_SCRIPTS_DIR, `${name}.json`);
  return parseScript(await readFile(path, "utf8"), path);
}

export async function recordedScriptNames(): Promise<string[]> {
  const files = await readdir(RECORDED_SCRIPTS_DIR).catch(() => []);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

/** The first prompt a recording answers; every recorded run starts with a user turn. */
export function firstUserPrompt(script: Script): string {
  const step = script[0];
  if (step === undefined || step.expect.role !== "user") {
    throw new Error("a recorded script must start with a user prompt");
  }
  return step.expect.text;
}

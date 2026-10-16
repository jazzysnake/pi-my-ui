#!/usr/bin/env node
// Re-record a named scripted-provider script from a real model-provider run.
//
// A recording is only trustworthy if the thing it stands in for produced it, so this command runs
// real pi against a real provider and rebuilds the script from the Session pi wrote. The named
// script supplies the prompts: the run repeats the prompts its recording answered, so the model
// sees the same conversation, and the command overwrites the script with what the model did this
// time round. The scripted provider replays the result; the smoke test in `packages/e2e` is the
// credential-gated counterpart that proves the round trip still holds.
//
// Usage: node scripts/rerecord.mjs <name> [--provider <id>] [--model <id>] [--list]
//   <name>               a file under packages/scripted-provider/scripts, without the .json suffix
//   --provider, --model  the real provider and model; default $PI_MY_UI_RECORD_PROVIDER and
//                        $PI_MY_UI_RECORD_MODEL, then anthropic and claude-sonnet-4-5
//   --list               print the recordable names and exit
//
// Credentials come from the environment (for example ANTHROPIC_API_KEY) or from pi's own auth. The
// command needs `npm run build` once, because it loads the scripted-provider package as pi does.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = fileURLToPath(
  new URL("../packages/scripted-provider/scripts/", import.meta.url),
);
const RECORD_MODULE = new URL("../packages/scripted-provider/dist/record.js", import.meta.url);
const INDEX_MODULE = new URL("../packages/scripted-provider/dist/index.js", import.meta.url);

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** A recording that cannot be read back is not a recording. */
function fail(message) {
  console.error(`[rerecord] ${message}`);
  process.exit(1);
}

function usage() {
  return [
    "usage: node scripts/rerecord.mjs <name> [--provider <id>] [--model <id>]",
    "       node scripts/rerecord.mjs --list",
  ].join("\n");
}

async function requireBuild() {
  if (!existsSync(RECORD_MODULE) || !existsSync(INDEX_MODULE)) {
    fail("the scripted provider is not built; run `npm run build` first");
  }
}

async function printNames() {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(SCRIPTS_DIR).catch(() => []);
  const names = files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
  for (const name of names) {
    console.log(name);
  }
}

/**
 * The user prompts one recording answers, in order. Consecutive repeats are retries of the same
 * turn, not new messages, so they are sent once or the re-recorded run would gain turns.
 */
function promptsOf(script) {
  const prompts = [];
  let previous;
  for (const step of script) {
    if (step.expect.role !== "user" || step.expect.text === previous) {
      continue;
    }
    previous = step.expect.text;
    prompts.push(step.expect.text);
  }
  return prompts;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      list: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help === true) {
    console.log(usage());
    return;
  }
  if (values.list === true) {
    await requireBuild();
    await printNames();
    return;
  }

  const name = positionals[0];
  if (name === undefined || positionals.length > 1) {
    fail(usage());
  }
  if (!NAME_PATTERN.test(name)) {
    fail(`"${name}" is not a script name; use lower-case letters, digits and dashes`);
  }

  await requireBuild();
  const { parseScript } = await import(INDEX_MODULE.href);
  const { recordRun, serializeScript, providerCredential, providerCredentialEnv } = await import(
    RECORD_MODULE.href
  );

  const scriptPath = join(SCRIPTS_DIR, `${name}.json`);
  if (!existsSync(scriptPath)) {
    fail(`no recording at ${scriptPath}; run with --list to see the names`);
  }
  const { readFile } = await import("node:fs/promises");
  const existing = parseScript(await readFile(scriptPath, "utf8"), scriptPath);
  const prompts = promptsOf(existing);
  if (prompts.length === 0) {
    fail(`${name}.json answers no user prompt, so there is nothing to re-record`);
  }

  const provider = values.provider ?? process.env["PI_MY_UI_RECORD_PROVIDER"] ?? DEFAULT_PROVIDER;
  const model = values.model ?? process.env["PI_MY_UI_RECORD_MODEL"] ?? DEFAULT_MODEL;
  if (providerCredential(provider, process.env) === undefined) {
    console.warn(
      `[rerecord] no ${providerCredentialEnv(provider).join(" or ")} in the environment; ` +
        "falling back to pi's own stored auth",
    );
  }

  const root = await mkdtemp(join(tmpdir(), "pi-my-ui-rerecord-"));
  const workspace = join(root, "workspace");
  const sessionDir = join(root, "sessions");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  console.log(`[rerecord] ${name}: ${String(prompts.length)} prompt(s) via ${provider}/${model}`);
  try {
    const recorded = await recordRun({
      prompts,
      provider,
      model,
      cwd: workspace,
      env: { ...process.env, PI_CODING_AGENT_SESSION_DIR: sessionDir },
    });
    await writeFile(scriptPath, serializeScript(recorded));
    const endings = recorded.map((step) => step.reply.stopReason).join(", ");
    console.log(`[rerecord] wrote ${String(recorded.length)} step(s) to ${scriptPath}`);
    console.log(`[rerecord] turn endings: ${endings}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();

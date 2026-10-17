/**
 * Recording: turning a real pi run into the script the scripted provider replays.
 *
 * A recording is the model side of a run: each assistant turn pi stored, bound to the message pi
 * sent the model just before it. Rebuilding that binding from pi's own Session file is what keeps a
 * recording tied to what pi actually did, rather than to whatever a test author remembered.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  RpcClient,
  getPackageDir,
  parseSessionEntries,
  type FileEntry,
  type JsonAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import { imageCountOf, textOf } from "./match.js";
import {
  ScriptError,
  type Script,
  type ScriptedBlock,
  type ScriptedReply,
  type ScriptStep,
} from "./script.js";

/**
 * Entry types that rewrite the model's context without naming the call that produced them. A flat
 * script of prompt/answer pairs cannot express the rewritten transcript, so recording stops rather
 * than binding a later reply to a prompt the model never saw in that form. A compaction entry is
 * excluded from this set because its summary is the model's own reply to pi's summary request, which
 * the script can bind to.
 */
const CONTEXT_REWRITES = new Set(["branch_summary", "context_edit", "custom_message"]);

/** The same hermetic launch every real or scripted pi child gets; only the provider differs. */
export const HERMETIC_PI_ARGS = [
  "--offline",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--no-themes",
  "--approve",
] as const;

type RecordedPrompt =
  | { readonly role: "user"; readonly text: string; readonly images?: number }
  | { readonly role: "toolResult"; readonly toolName: string; readonly text: string };

function blockOf(block: AssistantMessage["content"][number]): ScriptedBlock {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "thinking") {
    return { type: "thinking", thinking: block.thinking };
  }
  return { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments };
}

function replyOf(message: AssistantMessage, source: string): ScriptedReply {
  const { stopReason } = message;
  if (
    stopReason !== "stop" &&
    stopReason !== "toolUse" &&
    stopReason !== "length" &&
    stopReason !== "error"
  ) {
    throw new ScriptError(`${source}: cannot record a turn that ended as "${stopReason}"`);
  }
  const content = message.content.map(blockOf);
  // The script format keys tool execution off the stop reason; a turn that disagrees cannot be
  // replayed faithfully, so it must not be recorded at all.
  const callsTools = content.some((block) => block.type === "toolCall");
  if (callsTools !== (stopReason === "toolUse")) {
    throw new ScriptError(`${source}: a turn's tool calls and stop reason disagree`);
  }
  if (stopReason === "error") {
    const errorMessage = message.errorMessage;
    if (errorMessage === undefined || errorMessage === "") {
      throw new ScriptError(`${source}: an errored turn has no error message to record`);
    }
    return { content, stopReason, errorMessage };
  }
  return { content, stopReason };
}

function userPrompt(message: UserMessage, source: string): RecordedPrompt {
  const images = imageCountOf(message.content);
  if (typeof message.content !== "string") {
    // Blocks pi documents outside text and images cannot be replayed from a flat script.
    const unknown = (message.content as readonly { readonly type: string }[]).find(
      (block) => block.type !== "text" && block.type !== "image",
    );
    if (unknown !== undefined) {
      throw new ScriptError(
        `${source}: a ${unknown.type} block in a user message cannot be recorded`,
      );
    }
  }
  const text = textOf(message.content);
  // The image bytes are not recorded, only how many the model saw, which is what a replay checks.
  return images === 0 ? { role: "user", text } : { role: "user", text, images };
}

/**
 * The entries from the Session root to its last entry, which is the active conversation. The leaf is
 * the last entry rather than the last message: a Session compacted at its end ends in a compaction.
 */
function entryPath(entries: readonly FileEntry[], source: string): FileEntry[] {
  const byId = new Map<string, FileEntry>();
  let leaf: FileEntry | undefined;
  for (const entry of entries) {
    if (entry.type === "session") {
      continue;
    }
    byId.set(entry.id, entry);
    leaf = entry;
  }
  if (leaf === undefined) {
    throw new ScriptError(`${source}: the Session has no entry to record`);
  }

  const path: FileEntry[] = [];
  let current: FileEntry | undefined = leaf;
  while (current !== undefined && current.type !== "session") {
    path.push(current);
    if (path.length > entries.length) {
      throw new ScriptError(`${source}: the Session's parent links form a cycle`);
    }
    const parentId: string | null = current.parentId;
    current = parentId === null ? undefined : byId.get(parentId);
  }
  return path.reverse();
}

/** Record the model calls pi stored for one Session, in order. */
export function scriptFromSession(entries: readonly FileEntry[], source = "session"): Script {
  const steps: ScriptStep[] = [];
  let prompt: RecordedPrompt | undefined;

  for (const entry of entryPath(entries, source)) {
    if (entry.type === "session") {
      continue;
    }
    if (entry.type === "compaction") {
      // pi's summary request is not stored, so the recording binds the reply to the request's shape;
      // the summary text is the model's own words, as pi persisted them.
      steps.push({
        expect: { role: "compaction" },
        reply: { content: [{ type: "text", text: entry.summary }], stopReason: "stop" },
      });
      continue;
    }
    if (CONTEXT_REWRITES.has(entry.type)) {
      throw new ScriptError(
        `${source}: a Session with a ${entry.type} entry cannot be recorded as a flat script`,
      );
    }
    if (entry.type !== "message") {
      continue;
    }
    const { message } = entry;
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      prompt = userPrompt(message, source);
      continue;
    }
    if (message.role === "toolResult") {
      prompt = { role: "toolResult", toolName: message.toolName, text: textOf(message.content) };
      continue;
    }
    if (message.role !== "assistant") {
      throw new ScriptError(`${source}: cannot record a message with role "${message.role}"`);
    }
    if (prompt === undefined) {
      throw new ScriptError(`${source}: an assistant turn follows no user or tool-result entry`);
    }
    steps.push({ expect: prompt, reply: replyOf(message, source) });
  }

  if (steps.length === 0) {
    throw new ScriptError(`${source}: the Session has no assistant turn to record`);
  }
  return steps;
}

/** The on-disk form of a recording. Kept here so the command and the fixture loader agree. */
export function serializeScript(script: Script): string {
  return `${JSON.stringify(script, null, 2)}\n`;
}

export interface RecordRunOptions {
  readonly prompts: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly timeoutMs?: number;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;

function lastAssistantTurn(events: readonly JsonAgentSessionEvent[]): AssistantMessage | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && event.type === "message_end" && event.message.role === "assistant") {
      return event.message as AssistantMessage;
    }
  }
  return undefined;
}

/**
 * Run real pi against a real provider on `prompts` and record the model calls it made.
 *
 * A provider failure is raised rather than recorded: a script of error turns would look like a
 * successful recording and replay without ever reaching a model.
 */
export async function recordRun(options: RecordRunOptions): Promise<Script> {
  if (options.prompts.length === 0) {
    throw new ScriptError("recordRun: at least one prompt is required");
  }
  const child = new RpcClient({
    cliPath: join(getPackageDir(), "dist", "cli.js"),
    cwd: options.cwd,
    env: options.env,
    provider: options.provider,
    model: options.model,
    args: [...HERMETIC_PI_ARGS],
  });
  await child.start();
  try {
    const events: JsonAgentSessionEvent[] = [];
    for (const prompt of options.prompts) {
      events.push(
        ...(await child.promptAndWait(
          prompt,
          undefined,
          options.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
        )),
      );
    }
    const last = lastAssistantTurn(events);
    if (last?.stopReason === "error") {
      throw new ScriptError(
        `recordRun: the real provider failed: ${last.errorMessage ?? "no error message"}`,
      );
    }
    const { sessionFile } = await child.getState();
    if (sessionFile === undefined) {
      throw new ScriptError("recordRun: pi wrote no Session file for the run");
    }
    return scriptFromSession(parseSessionEntries(await readFile(sessionFile, "utf8")), sessionFile);
  } finally {
    await child.stop();
  }
}

/** Environment variables a provider reads its API key from, most specific first. */
const PROVIDER_CREDENTIAL_ENV: Record<string, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
};

export function providerCredentialEnv(provider: string): readonly string[] {
  const known = PROVIDER_CREDENTIAL_ENV[provider];
  if (known !== undefined) {
    return known;
  }
  return [`${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`];
}

/** The name of the environment variable that carries a key for `provider`, if one is set. */
export function providerCredential(
  provider: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return providerCredentialEnv(provider).find((name) => (env[name] ?? "") !== "");
}

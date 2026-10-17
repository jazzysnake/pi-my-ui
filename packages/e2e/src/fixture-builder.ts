import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
  type FileEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";

import type { HermeticHome } from "./pi-harness.js";

/** The curated seeds committed under `fixtures/seeds`, one per real-session shape. */
export const SEED_NAMES = ["plain", "branching", "compaction", "subagents", "large"] as const;
export type SeedName = (typeof SEED_NAMES)[number];

/** A generated extreme shape, produced on demand rather than committed. */
export type GeneratedShape = "transcript" | "deep-tree" | "subagents";

export interface GenerateOptions {
  /** Message entries in the `transcript` shape. */
  readonly transcriptEntries?: number;
  /** Levels in the `deep-tree` shape's main chain. */
  readonly depth?: number;
  /** Persisted subagent records in the `subagents` shape. */
  readonly subagentRecords?: number;
  /** Append one custom message pi marks hidden, so it must appear in neither tree nor transcript. */
  readonly hiddenCustomMessage?: boolean;
}

/** A Session file a test can hand to a Pi child: enough to find it and assert what it holds. */
export interface FixtureSession {
  readonly id: string;
  readonly path: string;
  readonly entryCount: number;
  readonly leafId: string | null;
}

const SEEDS_DIR = fileURLToPath(new URL("../fixtures/seeds/", import.meta.url));

const DEFAULT_TRANSCRIPT_ENTRIES = 520;
const DEFAULT_DEPTH = 100;
const DEFAULT_SUBAGENT_RECORDS = 50;

/** A fixed epoch keeps generated file bodies reproducible; SessionManager still stamps entries. */
const GENERATED_EPOCH_MS = Date.UTC(2030, 0, 1);

const GENERATED_USAGE: Usage = {
  input: 120,
  output: 40,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 160,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function parseSeed(text: string, source: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    entries.push(JSON.parse(line) as FileEntry);
  }
  const header = entries[0];
  if (header === undefined || header.type !== "session") {
    throw new Error(`${source}: the first line is not a pi Session header`);
  }
  return entries;
}

/**
 * Write entries as a Session file the session dir will discover. The header's cwd points at the
 * hermetic workspace, because a pi child filters the dir by the cwd it was launched for.
 */
async function writeSessionFile(
  home: HermeticHome,
  entries: readonly FileEntry[],
): Promise<FixtureSession> {
  const header = entries[0];
  if (header === undefined || header.type !== "session") {
    throw new Error("a Session file must start with a header");
  }
  await mkdir(home.sessionsDir, { recursive: true });
  const path = join(
    home.sessionsDir,
    `${header.timestamp.replace(/[:.]/g, "-")}_${header.id}.jsonl`,
  );
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return {
    id: header.id,
    path,
    entryCount: entries.length - 1,
    leafId: entries[entries.length - 1]?.id ?? null,
  };
}

/** Copy a committed seed into `home`, re-homed to this test's workspace. */
export async function seedSession(home: HermeticHome, name: SeedName): Promise<FixtureSession> {
  const text = await readFile(join(SEEDS_DIR, `${name}.jsonl`), "utf8");
  const entries = parseSeed(text, `${name}.jsonl`);
  const header = entries[0] as SessionHeader;
  const rehomed: FileEntry[] = [
    {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: header.id,
      timestamp: header.timestamp,
      cwd: home.workspace,
    },
    ...entries.slice(1),
  ];
  return await writeSessionFile(home, rehomed);
}

/** The two facts a Session file can add to its header: a parent pointer and a name. */
export interface ParentedSessionOptions {
  /** The Session file the new file names as its parent, as pi writes it for a fork or a child. */
  readonly parentSessionPath?: string;
  /** The name pi records in the file, which is what the drawer reads a row's title from. */
  readonly name: string;
  /** One user message, so the file is a Session with a transcript and not just a header. */
  readonly firstMessage: string;
}

/**
 * Write a Session that carries a parent pointer and a name, the two facts that tell a subagent's
 * child from the owner's own fork. pi's own writer stamps the header, so the file is one pi would
 * resume.
 */
export async function writeParentedSession(
  home: HermeticHome,
  options: ParentedSessionOptions,
): Promise<FixtureSession> {
  await mkdir(home.sessionsDir, { recursive: true });
  const manager = SessionManager.create(
    home.workspace,
    home.sessionsDir,
    options.parentSessionPath === undefined ? {} : { parentSession: options.parentSessionPath },
  );
  manager.appendSessionInfo(options.name);
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: options.firstMessage }],
    timestamp: Date.now(),
  });
  const path = manager.getSessionFile();
  if (path === undefined) {
    throw new Error("the parented session writer produced no Session file");
  }
  return {
    id: manager.getSessionId(),
    path,
    entryCount: manager.getEntries().length,
    leafId: manager.getLeafId(),
  };
}

/**
 * One assistant attempt that never became a reply, as pi records it after the prompt it answered. A
 * provider failure and a cancel are the two shapes that leave such a message behind.
 */
export interface AttemptTurn {
  readonly prompt: string;
  /** pi's own stop reason for a failed or a cancelled turn. */
  readonly stopReason: "error" | "aborted";
  /** The partial reply the attempt streamed before it stopped, if any. */
  readonly text?: string;
  /** The failure pi recorded; leaving it out exercises the transcript's own fallback text. */
  readonly errorMessage?: string;
}

/** Write a Session made only of prompts and the attempts that answered them. */
export async function writeAttemptsSession(
  home: HermeticHome,
  turns: readonly AttemptTurn[],
): Promise<FixtureSession> {
  await mkdir(home.sessionsDir, { recursive: true });
  const manager = SessionManager.create(home.workspace, home.sessionsDir);
  manager.appendSessionInfo(`Attempts: ${turns[0]?.prompt ?? "none"}`);
  for (const turn of turns) {
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: turn.prompt }],
      timestamp: Date.now(),
    });
    manager.appendMessage({
      role: "assistant",
      content: turn.text === undefined ? [] : [{ type: "text", text: turn.text }],
      api: "openai-completions",
      provider: "scripted",
      model: "scripted",
      usage: GENERATED_USAGE,
      stopReason: turn.stopReason,
      ...(turn.errorMessage === undefined ? {} : { errorMessage: turn.errorMessage }),
      timestamp: Date.now(),
    });
  }
  const path = manager.getSessionFile();
  if (path === undefined) {
    throw new Error("the attempt writer produced no Session file");
  }
  return {
    id: manager.getSessionId(),
    path,
    entryCount: manager.getEntries().length,
    leafId: manager.getLeafId(),
  };
}

function generatedTimestamp(index: number, offset = 0): number {
  return GENERATED_EPOCH_MS + index * 1000 + offset;
}

function userMessage(index: number, text = `Generated user message ${String(index)}.`) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text }],
    timestamp: generatedTimestamp(index),
  };
}

function assistantMessage(
  index: number,
  text = `Generated assistant reply ${String(index)}.`,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "scripted",
    model: "scripted",
    usage: GENERATED_USAGE,
    stopReason: "stop",
    timestamp: generatedTimestamp(index, 500),
  };
}

function assistantToolCall(
  index: number,
  name: string,
  arguments_: Record<string, string>,
): AssistantMessage {
  return {
    ...assistantMessage(index),
    content: [
      { type: "text", text: `Generated assistant reply ${String(index)}.` },
      { type: "toolCall", id: `call_seed_${String(index)}`, name, arguments: { ...arguments_ } },
    ],
    stopReason: "toolUse",
  };
}

function toolResult(index: number, toolCallId: string, toolName: string, text: string) {
  return {
    role: "toolResult" as const,
    toolCallId,
    toolName,
    content: [{ type: "text" as const, text }],
    isError: false,
    timestamp: generatedTimestamp(index, 700),
  };
}

function appendTranscript(manager: SessionManager, entries: number): void {
  for (let index = 0; index < entries; index += 1) {
    // A tool round every seventh entry keeps the shape realistic without dominating it.
    if (index % 7 === 3) {
      const callId = `call_seed_${String(index)}`;
      manager.appendMessage(
        assistantToolCall(index, "bash", { command: `echo seed-${String(index)}` }),
      );
      manager.appendMessage(toolResult(index, callId, "bash", `seed output ${String(index)}`));
      index += 1;
      continue;
    }
    manager.appendMessage(index % 2 === 0 ? userMessage(index) : assistantMessage(index));
  }
}

function appendDeepTree(manager: SessionManager, depth: number): void {
  const chain: string[] = [];
  for (let index = 0; index < depth; index += 1) {
    chain.push(
      manager.appendMessage(index % 2 === 0 ? userMessage(index) : assistantMessage(index)),
    );
  }
  for (const fraction of [0.33, 0.66]) {
    const anchor = chain[Math.floor(chain.length * fraction)];
    if (anchor === undefined) {
      continue;
    }
    manager.branch(anchor);
    manager.appendMessage(
      assistantMessage(9000 + Math.floor(fraction * 100), "Generated off-path reply."),
    );
  }
}

function subagentNotification(agentId: string, ordinal: number): string {
  return [
    "<task-notification>",
    `<task-id>${agentId}</task-id>`,
    `<status>Done</status>`,
    `<summary>Agent "Generated agent ${String(ordinal)}" completed</summary>`,
    `<result>Generated subagent result ${String(ordinal)}</result>`,
    "</task-notification>",
  ].join("\n");
}

function appendSubagents(manager: SessionManager, records: number): void {
  for (let ordinal = 0; ordinal < records; ordinal += 1) {
    const agentId = `seed-agent-${String(ordinal)}`;
    manager.appendMessage(userMessage(ordinal * 5, `Generated task ${String(ordinal)}.`));
    manager.appendMessage(
      assistantToolCall(ordinal * 5 + 1, "Agent", {
        description: `Generated agent ${String(ordinal)}`,
        prompt: `Generated prompt ${String(ordinal)}`,
        subagent_type: "general-purpose",
      }),
    );
    manager.appendMessage(
      toolResult(
        ordinal * 5 + 2,
        `call_seed_${String(ordinal * 5 + 1)}`,
        "Agent",
        `Generated agent ${String(ordinal)} finished`,
      ),
    );
    manager.appendCustomEntry("subagents:record", {
      id: agentId,
      type: "general-purpose",
      description: `Generated agent ${String(ordinal)}`,
      status: "completed",
      result: `Generated subagent result ${String(ordinal)}`,
      startedAt: generatedTimestamp(ordinal * 5),
      completedAt: generatedTimestamp(ordinal * 5, 1500),
    });
    manager.appendCustomMessageEntry(
      "subagent-notification",
      subagentNotification(agentId, ordinal),
      true,
      {
        id: agentId,
        description: `Generated agent ${String(ordinal)}`,
        status: "completed",
        toolUses: 3,
        totalTokens: 1200,
        durationMs: 1500,
        outputFile: `/tmp/pi-my-ui-seed/${agentId}.output`,
        resultPreview: `Generated subagent result ${String(ordinal)}`,
      },
    );
    manager.appendMessage(
      assistantMessage(ordinal * 5 + 3, `Generated summary ${String(ordinal)}.`),
    );
  }
}

/** Write an extreme shape into `home`, built with pi's own Session writer. */
export async function generateSession(
  home: HermeticHome,
  shape: GeneratedShape,
  options: GenerateOptions = {},
): Promise<FixtureSession> {
  await mkdir(home.sessionsDir, { recursive: true });
  const manager = SessionManager.create(home.workspace, home.sessionsDir);
  manager.appendModelChange("scripted", "scripted");
  manager.appendThinkingLevelChange("high");
  manager.appendSessionInfo(`Generated ${shape}`);

  if (shape === "transcript") {
    appendTranscript(manager, options.transcriptEntries ?? DEFAULT_TRANSCRIPT_ENTRIES);
    if (options.hiddenCustomMessage === true) {
      manager.appendCustomMessageEntry(
        "hidden-extension-message",
        "A hidden custom message the transcript must not show.",
        false,
      );
    }
  } else if (shape === "deep-tree") {
    appendDeepTree(manager, options.depth ?? DEFAULT_DEPTH);
  } else {
    appendSubagents(manager, options.subagentRecords ?? DEFAULT_SUBAGENT_RECORDS);
  }

  const path = manager.getSessionFile();
  if (path === undefined) {
    throw new Error(`the ${shape} generator produced no Session file`);
  }
  return {
    id: manager.getSessionId(),
    path,
    entryCount: manager.getEntries().length,
    leafId: manager.getLeafId(),
  };
}

/**
 * One Pi child for one Session file, reached through pi's own RPC client. The server never speaks
 * pi's JSONL protocol itself, so every command it uses is the one pi documents.
 */

import { join } from "node:path";

import {
  getPackageDir,
  RpcClient,
  type JsonAgentSessionEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  CommandInfo,
  ImageAttachment,
  ModelInfo,
  SessionStats,
  StreamingBehavior,
  ThinkingLevel,
} from "@pi-my-ui/protocol";

import type { PiLaunchOptions } from "./config.js";

export interface PiChildLaunch extends PiLaunchOptions {
  readonly cwd: string;
}

export interface PiEntries {
  readonly entries: readonly SessionEntry[];
  readonly leafId: string | null;
}

/** The status strip's facts, read in one call so a viewer sees a consistent set. */
export interface PiSettings {
  readonly model: ModelInfo | null;
  readonly availableModels: readonly ModelInfo[];
  readonly thinkingLevel: ThinkingLevel;
  readonly availableThinkingLevels: readonly ThinkingLevel[];
  readonly autoCompactionEnabled: boolean;
}

export interface PiChild {
  entries(): Promise<PiEntries>;
  /** Subscribe to pi's live event stream; returns an unsubscribe. */
  onEvent(listener: (event: JsonAgentSessionEvent) => void): () => void;
  prompt(
    text: string,
    images: readonly ImageAttachment[],
    behavior?: StreamingBehavior,
  ): Promise<void>;
  abort(): Promise<void>;
  settings(): Promise<PiSettings>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  /** Every command this child offers the palette: prompt templates, skills and extension commands. */
  commands(): Promise<readonly CommandInfo[]>;
  stats(): Promise<SessionStats>;
  setSessionName(name: string): Promise<void>;
  /** Write the Session's HTML export inside the served directory; returns its relative path. */
  exportHtml(): Promise<string>;
  stop(): Promise<void>;
}

/**
 * Which Session a Pi child opens: an existing file the server found, or a fresh id the server
 * generated. Pi names a new Session file itself, so the server must never invent the path.
 */
export type PiSessionTarget =
  | { readonly kind: "file"; readonly sessionFile: string }
  | { readonly kind: "id"; readonly sessionId: string };

/** The subset of pi's model record the wire carries. */
function toModelInfo(model: {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
}): ModelInfo {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name ?? model.id,
    reasoning: model.reasoning ?? false,
  };
}

/** Pi's `ImageContent` names the type `mimeType`; the contract names it `mediaType`. */
function toImageContent(image: ImageAttachment): ImageContent {
  return { type: "image", data: image.data, mimeType: image.mediaType };
}

/** pi answers an absent description with `undefined`; the wire carries one shape. */
function toCommandInfo(command: {
  readonly name: string;
  readonly description?: string | undefined;
  readonly source: CommandInfo["source"];
}): CommandInfo {
  return {
    name: command.name,
    description: command.description ?? "",
    source: command.source,
  };
}

/** Narrow pi's stats record to the contract, mapping the optional context usage to `null`. */
function toSessionStats(stats: {
  readonly sessionId: string;
  readonly sessionFile?: string | undefined;
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly totalMessages: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
  readonly cost: number;
  readonly contextUsage?: {
    readonly tokens: number | null;
    readonly contextWindow: number;
    readonly percent: number | null;
  };
}): SessionStats {
  const context = stats.contextUsage;
  return {
    sessionId: stats.sessionId,
    sessionFile: stats.sessionFile ?? null,
    userMessages: stats.userMessages,
    assistantMessages: stats.assistantMessages,
    toolCalls: stats.toolCalls,
    totalMessages: stats.totalMessages,
    tokens: {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
      total: stats.tokens.total,
    },
    cost: stats.cost,
    contextUsage:
      context === undefined
        ? null
        : {
            tokens: context.tokens,
            contextWindow: context.contextWindow,
            percent: context.percent,
          },
  };
}

/** Start a real `pi --mode rpc` child on an existing Session file or a fresh Session id. */
export async function startPiChild(
  target: PiSessionTarget,
  launch: PiChildLaunch,
): Promise<PiChild> {
  const sessionArgs =
    target.kind === "file" ? ["--session", target.sessionFile] : ["--session-id", target.sessionId];
  const client = new RpcClient({
    cwd: launch.cwd,
    cliPath: launch.cliPath ?? join(getPackageDir(), "dist", "cli.js"),
    args: [...(launch.args ?? []), ...sessionArgs],
    ...(launch.env === undefined ? {} : { env: { ...launch.env } }),
    ...(launch.provider === undefined ? {} : { provider: launch.provider }),
    ...(launch.model === undefined ? {} : { model: launch.model }),
  });
  await client.start();
  return {
    entries: () => client.getEntries(),
    onEvent: (listener) => client.onEvent(listener),
    prompt: async (text, images, behavior) => {
      await client.prompt(
        text,
        images.length === 0 ? undefined : images.map(toImageContent),
        behavior,
      );
    },
    abort: () => client.abort(),
    async settings() {
      const state = await client.getState();
      const [models, levels] = await Promise.all([
        client.getAvailableModels(),
        client.getAvailableThinkingLevels(),
      ]);
      return {
        model: state.model === undefined ? null : toModelInfo(state.model),
        availableModels: models.map(toModelInfo),
        thinkingLevel: state.thinkingLevel,
        availableThinkingLevels: levels,
        autoCompactionEnabled: state.autoCompactionEnabled,
      };
    },
    setModel: async (provider, modelId) => {
      await client.setModel(provider, modelId);
    },
    setThinkingLevel: (level) => client.setThinkingLevel(level),
    setAutoCompaction: (enabled) => client.setAutoCompaction(enabled),
    commands: async () => (await client.getCommands()).map(toCommandInfo),
    stats: async () => toSessionStats(await client.getSessionStats()),
    setSessionName: (name) => client.setSessionName(name),
    async exportHtml() {
      return (await client.exportHtml()).path;
    },
    stop: () => client.stop(),
  };
}

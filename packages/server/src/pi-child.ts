/**
 * One Pi child for one Session file, reached through pi's own RPC client. The server never speaks
 * pi's JSONL protocol itself, so every command it uses is the one pi documents.
 */

import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import {
  getPackageDir,
  RpcClient,
  type JsonAgentSessionEvent,
  type RpcCommand,
  type RpcResponse,
  type SessionEntry,
  type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  BashExecutionResult,
  CommandInfo,
  ForkMessage,
  ImageAttachment,
  ModelInfo,
  PiChildExit,
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

/** pi's own message tree, with the Leaf the Session is on. */
export interface PiTree {
  readonly tree: readonly SessionTreeNode[];
  readonly leafId: string | null;
}

/** A finished shell command: pi's result plus the output, which the live stream may have outpaced. */
export interface PiBashResult extends BashExecutionResult {
  readonly output: string;
}

/** The status strip's facts, read in one call so a viewer sees a consistent set. */
export interface PiSettings {
  readonly model: ModelInfo | null;
  readonly availableModels: readonly ModelInfo[];
  readonly thinkingLevel: ThinkingLevel;
  readonly availableThinkingLevels: readonly ThinkingLevel[];
  readonly autoCompactionEnabled: boolean;
}

/**
 * A fork or clone pi ran. `cancelled` means an extension's `session_before_fork` handler stopped the
 * mutation, so no Session was created; pi answers success either way.
 */
export interface PiSessionMutation {
  readonly cancelled: boolean;
}

export interface PiChild {
  entries(): Promise<PiEntries>;
  /** The Session's whole message tree, including branches off the active path. */
  tree(): Promise<PiTree>;
  /**
   * Send one prompt pi is expected to consume as a registered command, and report whether it did.
   * pi answers `handled` only for a command or input handler that took the message, so anything else
   * means the text went to the model, which for a command invocation is a failure to report.
   */
  runExtensionCommand(invocation: string): Promise<boolean>;
  /** Subscribe to pi's live event stream; returns an unsubscribe. */
  onEvent(listener: (event: JsonAgentSessionEvent) => void): () => void;
  prompt(
    text: string,
    images: readonly ImageAttachment[],
    behavior?: StreamingBehavior,
  ): Promise<void>;
  /** Run a shell command in the Session's working directory. */
  bash(command: string, excludeFromContext: boolean): Promise<PiBashResult>;
  abort(): Promise<void>;
  settings(): Promise<PiSettings>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  /** Compact the Session now; `customInstructions` is the focus typed after `/compact`. */
  compact(customInstructions?: string): Promise<void>;
  /** Every command this child offers the palette: prompt templates, skills and extension commands. */
  commands(): Promise<readonly CommandInfo[]>;
  stats(): Promise<SessionStats>;
  setSessionName(name: string): Promise<void>;
  /** Write the Session's HTML export inside the served directory; returns its relative path. */
  exportHtml(): Promise<string>;
  /** The user messages a fork can start from, in pi's order. */
  forkMessages(): Promise<readonly ForkMessage[]>;
  /** Branch the Session into a new file from `entryId`, which pi then binds this child to. */
  fork(entryId: string): Promise<PiSessionMutation>;
  /** Copy the active branch into a new file, which pi then binds this child to. */
  clone(): Promise<PiSessionMutation>;
  /** The Session id this child is bound to now; a completed fork or clone changes it. */
  sessionId(): Promise<string>;
  /**
   * Subscribe to the child's own exit, with pi's code and signal; returns an unsubscribe. A child the
   * server stopped deliberately is filtered out, so only an unexpected exit is reported.
   */
  onExit(listener: (exit: PiChildExit) => void): () => void;
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

type PiRawBashResult = Awaited<ReturnType<RpcClient["bash"]>>;

/**
 * pi's `RpcClient.bash` sends its own `bash` command without the published `excludeFromContext`
 * field, so a `!!` command would enter the model's context. The command shape and its response are
 * both exported by pi; use them through the same request path the client's own methods use.
 */
interface RawRpcClient {
  send(command: RpcCommand): Promise<RpcResponse>;
}

function toBashResult(result: PiRawBashResult): PiBashResult {
  return {
    output: result.output,
    exitCode: result.exitCode ?? null,
    cancelled: result.cancelled,
    truncated: result.truncated,
    ...(result.fullOutputPath === undefined ? {} : { fullOutputPath: result.fullOutputPath }),
  };
}

async function runBash(
  client: RpcClient,
  command: string,
  excludeFromContext: boolean,
): Promise<PiBashResult> {
  if (!excludeFromContext) {
    return toBashResult(await client.bash(command));
  }
  const response = await (client as unknown as RawRpcClient).send({
    type: "bash",
    command,
    excludeFromContext: true,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  if (response.command !== "bash") {
    throw new Error(`expected a bash response but received ${response.command}`);
  }
  return toBashResult(response.data);
}

/**
 * pi's RPC client owns the child process and reports its exit only as an error on the next request,
 * so a server would learn about a crash from an unrelated command, or never if the browser goes
 * quiet. The process pi spawned is the only live source of the exit facts a crash row shows, so the
 * child the client holds is read here. Worth knowing: if pi stops exposing it, a crash stops being
 * reported, which the browser crash spec fails on.
 */
function watchExit(client: RpcClient): {
  subscribe(listener: (exit: PiChildExit) => void): () => void;
} {
  const listeners = new Set<(exit: PiChildExit) => void>();
  const child = (client as unknown as { process: ChildProcess | null }).process;
  child?.once("exit", (code, signal) => {
    for (const listener of [...listeners]) {
      listener({ exitCode: code, signal });
    }
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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
  const exited = watchExit(client);
  let stoppedOnPurpose = false;
  return {
    entries: () => client.getEntries(),
    tree: () => client.getTree(),
    runExtensionCommand: async (invocation) => (await client.prompt(invocation)) === "handled",
    onEvent: (listener) => client.onEvent(listener),
    onExit: (listener) =>
      exited.subscribe((exit) => {
        if (!stoppedOnPurpose) {
          listener(exit);
        }
      }),
    prompt: async (text, images, behavior) => {
      await client.prompt(
        text,
        images.length === 0 ? undefined : images.map(toImageContent),
        behavior,
      );
    },
    bash: (command, excludeFromContext) => runBash(client, command, excludeFromContext),
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
    compact: async (customInstructions) => {
      await client.compact(customInstructions);
    },
    commands: async () => (await client.getCommands()).map(toCommandInfo),
    stats: async () => toSessionStats(await client.getSessionStats()),
    setSessionName: (name) => client.setSessionName(name),
    async exportHtml() {
      return (await client.exportHtml()).path;
    },
    forkMessages: () => client.getForkMessages(),
    fork: (entryId) => client.fork(entryId),
    clone: () => client.clone(),
    async sessionId() {
      return (await client.getState()).sessionId;
    },
    async stop() {
      stoppedOnPurpose = true;
      await client.stop();
    },
  };
}

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";
import {
  ContentBlockType,
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  type BashExecutionResult,
  type CompactionBoundaryEntry,
  type ErrorMessage,
  type RunStateKind,
  type ServerMessage,
  type SessionRef,
  type SnapshotMessage,
  type SubagentStatus,
} from "@pi-my-ui/protocol";

import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createGates, type Gate, type OwnedGates } from "../src/gate";
import { disposeHarnessInOrder } from "../src/harness-teardown";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession, type WsSessionClient } from "../src/ws-session-client";
import { readUntilText } from "../src/ws-transcript";

/** A script, or a builder for one: a command that must outlive the assertion names a gate. */
type ScriptSource = Script | ((gate: (name: string) => Gate) => Script);

/** The seeded Session never asks the model anything, but pi still needs a model it can resolve. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** A skill pi finds only by reading its agent directory at startup. */
const SKILL = "reloaded-skill";
const SKILL_COMMAND = `skill:${SKILL}`;

interface Harness {
  readonly home: HermeticHome;
  readonly first: string;
  readonly second: string;
  readonly firstSession: FixtureSession;
  readonly secondSession: FixtureSession;
  readonly server: RunningServer;
  gate(name: string): Gate;
  dispose(): Promise<void>;
}

interface HarnessOptions {
  readonly script?: ScriptSource;
  /** pi's own settings, written into the hermetic agent directory before the server starts. */
  readonly settings?: unknown;
}

async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const home = await createHermeticHome();
  const gates: OwnedGates = createGates(home);
  const secondDirectory = join(home.root, "second-project");
  await mkdir(secondDirectory, { recursive: true });
  const first = await realpath(home.workspace);
  const second = await realpath(secondDirectory);
  const firstSession = await seedSession(home, "plain");
  const secondSession = await seedSession(home, "branching", { project: second });
  if (options.settings !== undefined) {
    await mkdir(home.agentDir, { recursive: true });
    await writeFile(
      join(home.agentDir, "settings.json"),
      `${JSON.stringify(options.settings, null, 2)}\n`,
      "utf8",
    );
  }
  const script = options.script ?? UNUSED_SCRIPT;
  const launch = await scriptedPiLaunch(
    home,
    typeof script === "function" ? script(gates.gate) : script,
  );
  // The hermetic arguments switch skills off, and a reload's whole promise is that startup files are
  // read again, so this Session's children run with the agent directory's skills enabled.
  const args = launch.args.filter((argument) => argument !== "--no-skills");
  const server = await startServer({
    projects: [first, second],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args, env: launch.env, provider: launch.provider, model: launch.model },
  });
  let disposal: Promise<void> | undefined;
  return {
    home,
    first,
    second,
    firstSession,
    secondSession,
    server,
    gate: gates.gate,
    dispose: () => {
      disposal ??= disposeHarnessInOrder(gates, [() => server.close(), () => home.dispose()]);
      return disposal;
    },
  };
}

/**
 * Write the skill into the hermetic agent directory. Called only after the first Commands frame, so
 * the child that answered it has provably never read this file.
 */
async function writeSkill(harness: Harness): Promise<void> {
  const directory = join(harness.home.agentDir, "skills", SKILL);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${SKILL}\ndescription: Written while the Session was attached.\n---\n\nSay it again.`,
    "utf8",
  );
}

/** The three surfaces an attach sends after its Snapshot, in the order they arrive. */
async function readSurfaces(client: WsSessionClient): Promise<ServerMessage[]> {
  const surfaces: ServerMessage[] = [];
  while (surfaces.length < 3) {
    const message = await client.next();
    if (
      message.type === "settings" ||
      message.type === "commands" ||
      message.type === "contextUsage"
    ) {
      surfaces.push(message);
    }
  }
  return surfaces;
}

/** Open a Session the way the client does: subscribe, read the Snapshot, then its surfaces. */
async function attach(client: WsSessionClient, session: SessionRef): Promise<void> {
  client.send({ type: "subscribe", session });
  const snapshot = await client.next();
  if (snapshot.type !== "snapshot") {
    throw new Error(`the subscribe answered with ${snapshot.type}`);
  }
  await readSurfaces(client);
}

/**
 * Everything a reload sends back, up to its reply. A pushed Session list is a list refresh rather
 * than part of the answer, so it is skipped instead of counted.
 */
async function reloadFrames(client: WsSessionClient): Promise<ServerMessage[]> {
  const frames: ServerMessage[] = [];
  for (let read = 0; read < 20; read += 1) {
    const message = await client.next();
    if (message.type === "sessions") {
      continue;
    }
    if (message.type === "error") {
      throw new Error(`the reload was refused: ${message.error.message}`);
    }
    frames.push(message);
    if (message.type === "reloaded") {
      return frames;
    }
  }
  throw new Error("the reload answered with no reply");
}

/**
 * The frames up to and including the next one of `type`. A request this server answers after the
 * reload was handled is a fence: everything the reload was going to send has already been written
 * to the socket, so a list of what arrived is a list of all that arrived.
 */
async function readUntil(
  client: WsSessionClient,
  type: ServerMessage["type"],
): Promise<ServerMessage[]> {
  const frames: ServerMessage[] = [];
  for (let read = 0; read < 40; read += 1) {
    const message = await client.next();
    if (message.type === "sessions") {
      continue;
    }
    frames.push(message);
    if (message.type === type) {
      return frames;
    }
  }
  throw new Error(`the server sent no ${type}`);
}

test("a reload starts a new child on the same Session file and re-reads pi's configuration", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    client.send({ type: "subscribe", session });
    const before = await client.next();
    if (before.type !== "snapshot") {
      throw new Error(`the subscribe answered with ${before.type}`);
    }
    const attached = await readSurfaces(client);
    const commands = attached.find((message) => message.type === "commands");
    if (commands?.type !== "commands") {
      throw new Error("the attach sent no Commands");
    }
    expect(commands.commands.map((command) => command.name)).not.toContain(SKILL_COMMAND);

    await writeSkill(harness);
    client.send({ type: "reload", session });
    const frames = await reloadFrames(client);

    // The order is the contract: a client that acts on the reply is already looking at the new state.
    expect(frames.map((message) => message.type)).toEqual([
      "snapshot",
      "settings",
      "commands",
      "contextUsage",
      "reloaded",
    ]);
    const [reseeded, settings, refreshed, usage, reply] = frames;
    if (
      reseeded?.type !== "snapshot" ||
      settings?.type !== "settings" ||
      refreshed?.type !== "commands" ||
      usage?.type !== "contextUsage" ||
      reply?.type !== "reloaded"
    ) {
      throw new Error("the reload answered with frames the order check did not name");
    }

    // The Session is its file, so everything that names it comes back from the new child unchanged.
    expect(reseeded.session).toEqual(session);
    expect(reseeded.projection.sessionId).toBe(before.projection.sessionId);
    expect(reseeded.projection.entries.map((entry) => entry.id)).toEqual(
      before.projection.entries.map((entry) => entry.id),
    );
    expect(reseeded.projection.leafId).toBe(before.projection.leafId);

    // The new child answers from the files it read at startup, so a skill written after the first
    // Commands frame is exactly what a reload adds.
    expect(refreshed.commands.map((command) => command.name)).toContain(SKILL_COMMAND);
    expect(settings.availableModels.length).toBeGreaterThan(0);

    expect(reply.session).toEqual(session);
    // The wording belongs to the client, so the reply carries nothing but the Session it names.
    expect(Object.keys(reply).sort()).toEqual(["session", "type"]);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("a reload re-sends the surfaces to every viewer and answers only the requester", async () => {
  const harness = await startHarness();
  const requester = await connectWsSession(harness.server.url);
  const watcher = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    for (const viewer of [requester, watcher]) {
      viewer.send({ type: "subscribe", session });
      const snapshot = await viewer.next();
      expect(snapshot.type).toBe("snapshot");
      await readSurfaces(viewer);
    }

    requester.send({ type: "reload", session });
    expect((await reloadFrames(requester)).map((message) => message.type)).toEqual([
      "snapshot",
      "settings",
      "commands",
      "contextUsage",
      "reloaded",
    ]);

    // The second viewer's settings, palette and context figure came from the child that is gone, so
    // the reseed is not enough: it needs the same three surfaces, and no notice for someone else's
    // reload.
    watcher.send({ type: "getSessionStats", session });
    const watched = await readUntil(watcher, "sessionStats");
    const types = watched.map((message) => message.type);
    expect(types[0]).toBe("snapshot");
    expect(types).toEqual(expect.arrayContaining(["settings", "commands", "contextUsage"]));
    expect(types).not.toContain("reloaded");
  } finally {
    await watcher.close();
    await requester.close();
    await harness.dispose();
  }
});

test("a reload in one Session leaves another Session untouched", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  const other = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    const untouched = { project: harness.second, id: harness.secondSession.id };
    await attach(client, session);
    await attach(other, untouched);

    client.send({ type: "reload", session });
    expect((await reloadFrames(client)).at(-1)).toEqual({ type: "reloaded", session });

    // A reload is one Session and one child, so the other Project's Session sees no reseed at all,
    // and its own child answers a read without having been replaced.
    other.send({ type: "getSessionStats", session: untouched });
    const watched = await readUntil(other, "sessionStats");
    const types = watched.map((message) => message.type);
    expect(types).not.toContain("snapshot");
    expect(types).not.toContain("reloaded");
    const answered = watched.at(-1);
    if (answered?.type !== "sessionStats") {
      throw new Error("the untouched Session answered no statistics");
    }
    expect(answered.session).toEqual(untouched);
  } finally {
    await other.close();
    await client.close();
    await harness.dispose();
  }
});

/** Read Deltas until the Projection reports `kind`, which is the state a refusal is about. */
async function untilRunState(client: WsSessionClient, kind: RunStateKind): Promise<void> {
  for (let read = 0; read < 200; read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    const reached = message.deltas.some(
      (delta) => delta.kind === ProjectionDeltaKind.RunState && delta.runState.kind === kind,
    );
    if (reached) {
      return;
    }
  }
  throw new Error(`the run never reported ${kind}`);
}

/** Read until a projected direct shell card satisfies `ready`, returning the result it carries. */
async function untilShellCard(
  client: WsSessionClient,
  ready: (result: BashExecutionResult | undefined) => boolean,
): Promise<BashExecutionResult | undefined> {
  for (let read = 0; read < 200; read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    for (const delta of message.deltas) {
      if (delta.kind !== ProjectionDeltaKind.EntryUpsert) {
        continue;
      }
      const entry = delta.entry;
      if (entry.kind !== EntryKind.Message || entry.role !== MessageRole.Bash) {
        continue;
      }
      for (const block of entry.blocks) {
        if (block.type === ContentBlockType.BashExecution && ready(block.result)) {
          return block.result;
        }
      }
    }
  }
  throw new Error("the shell card never reached the state the test waited for");
}

/** Read until compaction replaced the earlier history, and report the boundary it wrote. */
async function untilBoundary(client: WsSessionClient): Promise<CompactionBoundaryEntry> {
  for (let read = 0; read < 200; read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    for (const delta of message.deltas) {
      if (
        delta.kind === ProjectionDeltaKind.EntryUpsert &&
        delta.entry.kind === EntryKind.CompactionBoundary
      ) {
        return delta.entry;
      }
    }
  }
  throw new Error("the compaction never wrote a boundary");
}

/** The refusal one reload received, which is the whole answer a refused request gets. */
async function refusalOf(client: WsSessionClient): Promise<ErrorMessage> {
  const frames = await readUntil(client, "error");
  const refusal = frames.at(-1);
  if (refusal?.type !== "error") {
    throw new Error("the reload was answered with no error");
  }
  return refusal;
}

const STREAMING_PROMPT = "hold the turn open";
const STREAMING_REPLY = "the held turn finished";

function streamingScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: STREAMING_PROMPT },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_slow_command",
            name: "bash",
            arguments: { ...gate("streaming-turn").command("echo the held command ran") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: STREAMING_REPLY }], stopReason: "stop" },
    },
  ];
}

test("a reload is refused while a turn streams, and the turn still finishes", async () => {
  const harness = await startHarness({ script: streamingScript });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    await harness.gate("streaming-turn").releaseAfter(async () => {
      client.send({ type: "prompt", session, text: STREAMING_PROMPT });
      await untilRunState(client, "streaming");
      client.send({ type: "reload", session });
      expect(await refusalOf(client)).toMatchObject({
        type: "error",
        session,
        error: {
          code: "commandFailed",
          message: "Wait for the current response to finish before reloading.",
        },
      });
    });

    // Nothing was replaced: the turn's own reply still arrives on the stream it was streaming to.
    const deltas = await readUntilText(client, STREAMING_REPLY);
    expect(deltas.length).toBeGreaterThan(0);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

const RETRY_PROMPT = "try the turn again";
const RETRY_REPLY = "the retried turn finished";

/**
 * A turn that fails retryably and then succeeds. pi backs off between attempts, and a turn waiting to
 * retry is a turn a reload would cut; the backoff is pi's own setting widened so the state is
 * observably live rather than a window the test races.
 */
const RETRY_SCRIPT: Script = [
  {
    expect: { role: "user", text: RETRY_PROMPT },
    reply: { content: [], stopReason: "error", errorMessage: "529 overloaded" },
  },
  {
    expect: { role: "user", text: RETRY_PROMPT },
    reply: { content: [{ type: "text", text: RETRY_REPLY }], stopReason: "stop" },
  },
];

const RETRY_SETTINGS = { retry: { baseDelayMs: 4000 } };

test("a reload is refused while a turn retries, and the retry still finishes", async () => {
  const harness = await startHarness({ script: RETRY_SCRIPT, settings: RETRY_SETTINGS });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    client.send({ type: "prompt", session, text: RETRY_PROMPT });
    await untilRunState(client, "retrying");
    client.send({ type: "reload", session });
    expect(await refusalOf(client)).toMatchObject({
      type: "error",
      session,
      error: {
        code: "commandFailed",
        message: "Wait for the current response to finish before reloading.",
      },
    });

    const deltas = await readUntilText(client, RETRY_REPLY);
    expect(deltas.length).toBeGreaterThan(0);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

/**
 * pi's own compaction settings, written into the hermetic home: the committed seeds are small, so a
 * default keep-recent budget would keep every message and pi would refuse to compact at all. The
 * retry delay is pi's, widened so the test observes a compaction that is genuinely still running.
 */
const COMPACTION_SETTINGS = {
  compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 100 },
  retry: { baseDelayMs: 4000 },
};
const SUMMARY = "The session had read the API surface and agreed on the next step.";

/** A summarization that fails once and is retried, so the compaction stays live for the refusal. */
const COMPACTION_SCRIPT: Script = [
  {
    expect: { role: "compaction" },
    reply: { content: [], stopReason: "error", errorMessage: "529 overloaded" },
  },
  {
    expect: { role: "compaction" },
    reply: { content: [{ type: "text", text: SUMMARY }], stopReason: "stop" },
  },
];

test("a reload is refused while a compaction runs, and the compaction still finishes", async () => {
  const harness = await startHarness({
    script: COMPACTION_SCRIPT,
    settings: COMPACTION_SETTINGS,
  });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    client.send({ type: "compact", session });
    await untilRunState(client, "compacting");
    client.send({ type: "reload", session });
    expect(await refusalOf(client)).toMatchObject({
      type: "error",
      session,
      error: {
        code: "commandFailed",
        message: "Wait for compaction to finish before reloading.",
      },
    });

    // The child was never stopped, so pi's retry produced the summary and the boundary landed.
    expect((await untilBoundary(client)).summary).toContain(SUMMARY);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("a reload is refused while a direct shell command has no result, and the command finishes", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    const command = harness.gate("shell-command").command("echo the build finished");
    await harness.gate("shell-command").releaseAfter(async () => {
      client.send({
        type: "bash",
        session,
        command: command.command,
        excludeFromContext: false,
      });
      await untilShellCard(client, (result) => result === undefined);
      client.send({ type: "reload", session });
      const refusal = await refusalOf(client);
      expect(refusal).toMatchObject({
        type: "error",
        session,
        error: { code: "commandFailed" },
      });
      // The refusal names the command whose output a reload would destroy unread.
      expect(refusal.error.message).toContain(command.command);
    });

    // The command kept its process: its exit status reaches the card the viewer is reading.
    expect(await untilShellCard(client, (result) => result !== undefined)).toMatchObject({
      exitCode: 0,
    });
  } finally {
    await client.close();
    await harness.dispose();
  }
});

/** Read until an agent reports `status`; with `idle`, the Session's own run must be idle as well. */
async function untilAgent(
  client: WsSessionClient,
  status: SubagentStatus,
  idle = false,
): Promise<void> {
  let reported = false;
  let settled = !idle;
  for (let read = 0; read < 300 && !(reported && settled); read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    for (const delta of message.deltas) {
      if (delta.kind === ProjectionDeltaKind.SubagentUpsert && delta.agent.status === status) {
        reported = true;
      }
      if (delta.kind === ProjectionDeltaKind.RunState && delta.runState.kind === "idle") {
        settled = true;
      }
    }
  }
  if (!reported || !settled) {
    throw new Error(`the Session never showed a ${status} agent with its own run idle`);
  }
}

const SPAWN_PROMPT = "spawn a helper in the background";
const PARENT_REPLY = "the background helper is running";
const AGENT_REPLY = "the helper did its work";

/**
 * A background spawn: the parent settles while the subagent is blocked on the run gate, so the only
 * work left in the Session is an agent that a reload would abort without being asked.
 */
function backgroundAgentScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: SPAWN_PROMPT },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_background_agent",
            name: "Agent",
            arguments: {
              subagent_type: "general-purpose",
              prompt: "work slowly",
              description: "Work slowly",
              run_in_background: true,
            },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "Agent" },
      reply: { content: [{ type: "text", text: PARENT_REPLY }], stopReason: "stop" },
    },
    {
      expect: { role: "user", text: "work slowly" },
      reply: {
        content: [
          {
            type: "toolCall",
            id: "call_agent_command",
            name: "bash",
            arguments: { ...gate("subagent-run").command("echo the helper did its work") },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      expect: { role: "toolResult", toolName: "bash" },
      reply: { content: [{ type: "text", text: AGENT_REPLY }], stopReason: "stop" },
    },
  ];
}

test("a reload is refused while a subagent runs, and the subagent still finishes", async () => {
  const harness = await startHarness({ script: backgroundAgentScript });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    await attach(client, session);

    await harness.gate("subagent-run").releaseAfter(async () => {
      client.send({ type: "prompt", session, text: SPAWN_PROMPT });
      await untilAgent(client, "running", true);
      client.send({ type: "reload", session });
      expect(await refusalOf(client)).toMatchObject({
        type: "error",
        session,
        // A count, so one agent is told apart from several.
        error: { code: "commandFailed", message: "1 subagent is still queued or running" },
      });
    });

    // The agent kept its process and finished, which a replaced child could not have done.
    await untilAgent(client, "completed");
  } finally {
    await client.close();
    await harness.dispose();
  }
});

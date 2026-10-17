// The evidence behind the pool's idle-eviction defaults: what one Pi child costs to keep, to stream
// through and to run a subagent in, and what it costs to start one again.
//
// This is an instrument, not a gate. It is outside `npm run verify:full` because its numbers belong to the
// machine it runs on, and the recorded results in `docs/measurements.md` name that machine. Run it
// with `npm run measure:pool`, after `npm run build`.

import { expect, test } from "@playwright/test";

import { HEALTHZ_PATH, startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { generateSession, seedSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { piChildPids } from "../src/pi-processes";
import { connectWsSession, type WsSessionClient } from "../src/ws-session-client";
import { readUntilText } from "../src/ws-transcript";
import { mb, peakWhile, residentKb } from "./rss";

test.describe.configure({ mode: "serial", timeout: 300_000 });

/** Short enough that eviction is observed in real time rather than waited out for minutes. */
const IDLE_TIMEOUT_MS = 1_500;
/** How long a child may take to be gone after its idle window closed. */
const EVICTION_BOUND_MS = 20_000;
/** Long enough for the child to settle after a run, so an idle figure is not a peak. */
const SETTLE_MS = 1_500;
const SESSIONS_IN_STRESS = 8;

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

const STREAM_PROMPT = "stream a long reply";
const STREAM_END = "the streamed reply ended";
/** Large enough that a reply is a visible amount of state rather than one short string. */
const STREAMED_TEXT = `${"streamed line of output. ".repeat(600)}${STREAM_END}`;
const STREAM_SCRIPT: Script = [
  {
    expect: { role: "user", text: STREAM_PROMPT },
    reply: { content: [{ type: "text", text: STREAMED_TEXT }], stopReason: "stop" },
  },
];

const SUBAGENT_PROMPT = "delegate the build";
const SUBAGENT_TEXT = "watching the build";
const SUBAGENT_DONE = "the parent finished";
/**
 * The agent holds its run open with a command, so the child runs the subagent for as long as it
 * takes to sample. Only the model is scripted; the agent and its process are pi's.
 */
const SUBAGENT_SCRIPT: Script = [
  {
    expect: { role: "user", text: SUBAGENT_PROMPT },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_agent_1",
          name: "Agent",
          arguments: {
            subagent_type: "general-purpose",
            prompt: "watch the build",
            description: "Watch the build",
            run_in_background: false,
          },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "user", text: "watch the build" },
    reply: {
      content: [
        { type: "text", text: SUBAGENT_TEXT },
        {
          type: "toolCall",
          id: "call_subagent_bash_1",
          name: "bash",
          arguments: { command: "sleep 5 && echo built", timeout: 30 },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "bash" },
    reply: { content: [{ type: "text", text: "the agent finished" }], stopReason: "stop" },
  },
  {
    expect: { role: "toolResult", toolName: "Agent" },
    reply: { content: [{ type: "text", text: SUBAGENT_DONE }], stopReason: "stop" },
  },
];

const FINDINGS: string[] = [];

function report(line: string): void {
  FINDINGS.push(line);
  console.log(`[pool-footprint] ${line}`);
}

test.afterAll(() => {
  if (FINDINGS.length === 0) {
    return;
  }
  console.log("\n[pool-footprint] recorded findings");
  for (const line of FINDINGS) {
    console.log(`[pool-footprint]   ${line}`);
  }
});

interface Launched {
  readonly home: HermeticHome;
  readonly server: RunningServer;
  readonly cwd: string;
}

async function launch(script: Script, options: { piSubagents?: boolean } = {}): Promise<Launched> {
  const home = await createHermeticHome();
  const launchOptions =
    options.piSubagents === undefined ? {} : { piSubagents: options.piSubagents };
  const launch = await scriptedPiLaunch(home, script, launchOptions);
  const server = await startServer({
    cwd: launch.cwd,
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  });
  return { home, server, cwd: launch.cwd };
}

async function dispose(launched: Launched): Promise<void> {
  await launched.server.close();
  // A measurement that leaves a child behind would measure it in the next case, so the process tree
  // is empty before the tree holding its working directory goes away.
  await waitForNoChildren();
  await launched.home.dispose();
}

/** Subscribe and wait for the Snapshot, which is the moment a Session is servable. */
async function open(server: RunningServer, sessionId: string): Promise<WsSessionClient> {
  const client = await connectWsSession(server.url);
  client.send({ type: "subscribe", sessionId });
  for (;;) {
    const message = await client.next();
    if (message.type === "snapshot") {
      return client;
    }
    if (message.type === "error") {
      throw new Error(`subscribing to ${sessionId} was refused: ${message.error.code}`);
    }
  }
}

async function waitForNoChildren(): Promise<void> {
  const deadline = Date.now() + EVICTION_BOUND_MS;
  while (piChildPids().length > 0) {
    if (Date.now() > deadline) {
      throw new Error(`a Pi child outlived its idle window; still alive: ${piChildPids().join()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The server runs inside this worker, so its figure includes the measurement harness around it. */
function hostProcessRss(): string {
  return `${mb(residentKb(process.pid) ?? 0)} of worker process (server plus harness)`;
}

function childRss(): string {
  const pids = piChildPids();
  const readings = pids.map((pid) => residentKb(pid) ?? 0);
  const total = readings.reduce((sum, kb) => sum + kb, 0);
  return `${mb(total)} across ${String(pids.length)} child(ren)`;
}

test("one idle Pi child: cold start, idle footprint, eviction and respawn", async () => {
  const launched = await launch(UNUSED_SCRIPT);
  try {
    const seeded = await seedSession(launched.home, "plain");
    const startedAt = performance.now();
    const viewer = await open(launched.server, seeded.id);
    const coldStartMs = performance.now() - startedAt;
    report(`cold start to a served Session: ${coldStartMs.toFixed(0)} ms`);
    report(`a Session's child while seeding: ${childRss()}`);

    // Let the first run of the child settle so the figure is an idle one, not a start-up peak.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    report(`one idle Pi child: ${childRss()}; ${hostProcessRss()}`);

    await viewer.close();
    await waitForNoChildren();
    report(`after eviction: no child alive; ${hostProcessRss()}`);

    const respawnAt = performance.now();
    const reopened = await open(launched.server, seeded.id);
    report(`respawn of an evicted Session: ${(performance.now() - respawnAt).toFixed(0)} ms`);
    await reopened.close();
  } finally {
    await dispose(launched);
  }
});

test("a Pi child streaming a long reply", async () => {
  const launched = await launch(STREAM_SCRIPT);
  try {
    const seeded = await seedSession(launched.home, "plain");
    const viewer = await open(launched.server, seeded.id);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const idle = residentKb(piChildPids()[0] ?? 0) ?? 0;
    report(`idle child before a streamed reply: ${mb(idle)}`);

    const peak = await peakWhile(async () => {
      viewer.send({ type: "prompt", sessionId: seeded.id, text: STREAM_PROMPT });
      await readUntilText(viewer, STREAM_END);
    }, piChildPids);
    const highest = Math.max(0, ...Object.values(peak.perPidKb));
    report(
      `peak of a child streaming a ${String(Math.round(STREAMED_TEXT.length / 1024))} KB reply: ${mb(highest)} (+${mb(highest - idle)} over idle, ${String(peak.samples)} samples)`,
    );
    await viewer.close();
  } finally {
    await dispose(launched);
  }
});

test("a Pi child running a subagent", async () => {
  const launched = await launch(SUBAGENT_SCRIPT, { piSubagents: true });
  try {
    const seeded = await seedSession(launched.home, "plain");
    const viewer = await open(launched.server, seeded.id);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const idle = residentKb(piChildPids()[0] ?? 0) ?? 0;
    report(`idle child before a subagent: ${mb(idle)}`);

    const peak = await peakWhile(async () => {
      viewer.send({ type: "prompt", sessionId: seeded.id, text: SUBAGENT_PROMPT });
      await readUntilText(viewer, SUBAGENT_DONE, []);
    }, piChildPids);
    const highest = Math.max(0, ...Object.values(peak.perPidKb));
    report(
      `peak of a child running a subagent: ${mb(highest)} (+${mb(highest - idle)} over idle, ${String(peak.samples)} samples, ${String(piChildPids().length)} pi process(es))`,
    );
    await viewer.close();
  } finally {
    await dispose(launched);
  }
});

test(`stress: ${String(SESSIONS_IN_STRESS)} watched Sessions and the memory eviction returns`, async () => {
  const launched = await launch(UNUSED_SCRIPT);
  try {
    const viewers: WsSessionClient[] = [];
    for (let index = 0; index < SESSIONS_IN_STRESS; index += 1) {
      const seeded = await generateSession(launched.home, "transcript", { transcriptEntries: 60 });
      viewers.push(await open(launched.server, seeded.id));
    }
    expect(piChildPids()).toHaveLength(SESSIONS_IN_STRESS);

    const busiest = piChildPids().map((pid) => residentKb(pid) ?? 0);
    const children = busiest.reduce((sum, kb) => sum + kb, 0);
    report(
      `${String(SESSIONS_IN_STRESS)} live children: ${mb(children)} of children (${mb(Math.round(children / SESSIONS_IN_STRESS))} each)`,
    );

    const health = await fetch(`${launched.server.httpUrl}${HEALTHZ_PATH}`);
    expect(health.status).toBe(200);

    for (const viewer of viewers) {
      await viewer.close();
    }
    await waitForNoChildren();
    report(`after every child was evicted: all ${mb(children)} of children returned`);

    // Eviction that left the server unable to serve the next Session would be a failure, not a
    // measurement, so the last step is a real Session opened after the whole pool was reclaimed.
    const seeded = await seedSession(launched.home, "plain");
    const reopened = await open(launched.server, seeded.id);
    await reopened.close();
  } finally {
    await dispose(launched);
  }
});

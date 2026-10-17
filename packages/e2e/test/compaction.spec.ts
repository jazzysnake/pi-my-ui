import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import {
  EntryKind,
  ProjectionDeltaKind,
  type CompactionBoundaryEntry,
  type ContextUsage,
  type ServerMessage,
} from "@pi-my-ui/protocol";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const SUMMARY = "The session had read the API surface and agreed on the next step.";
const TURN_PREFIX_SUMMARY = "The turn under way was comparing two options.";

/**
 * pi's own compaction settings, written into the hermetic home. The committed seeds are small, so
 * the default keep-recent budget would keep every message and pi would refuse to compact at all;
 * a small budget is a real pi setting, not a stand-in for pi.
 */
const COMPACTION_SETTINGS = {
  compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 100 },
};

/**
 * The model calls a manual compaction can make: pi summarizes the history, then, when the cut splits
 * a turn, that turn's earlier half. A seed whose cut leaves no history makes only the second call.
 */
function compactionSteps(customInstructions?: string): Script {
  return [
    {
      expect:
        customInstructions === undefined
          ? { role: "compaction" }
          : { role: "compaction", customInstructions },
      reply: { content: [{ type: "text", text: SUMMARY }], stopReason: "stop" },
    },
    {
      expect: { role: "user", text: MEASURE_AFTER_COMPACTION_PROMPT },
      reply: {
        content: [{ type: "text", text: MEASURE_AFTER_COMPACTION_REPLY }],
        stopReason: "stop",
      },
    },
  ];
}

/** A follow-up turn, because pi measures the compacted context on the next model call. */
const MEASURE_AFTER_COMPACTION_PROMPT = "measure the compacted context";
const MEASURE_AFTER_COMPACTION_REPLY = "the compacted context was measured";

/** The start of the reply a test can wait for; the padding is what makes the turn summable. */
const NOTE_REPLY_START = "The note is added.";
const NOTE_REPLY = `${NOTE_REPLY_START} ${"Padding keeps the newest turn above pi's keep-recent budget. ".repeat(40)}`;
const HISTORY_SUMMARY = "The first turn was summarized with the focus that was asked for.";

/**
 * A run whose second turn is worth compacting: pi then summarizes the first turn, and only that
 * summary request carries the focus the user typed.
 */
function instructionCompactionSteps(): Script {
  return [
    {
      expect: { role: "user", text: "add a note" },
      reply: { content: [{ type: "text", text: NOTE_REPLY }], stopReason: "stop" },
    },
    {
      expect: { role: "compaction", customInstructions: "keep the API surface" },
      reply: { content: [{ type: "text", text: HISTORY_SUMMARY }], stopReason: "stop" },
    },
    {
      expect: { role: "compaction" },
      reply: { content: [{ type: "text", text: TURN_PREFIX_SUMMARY }], stopReason: "stop" },
    },
  ];
}

/** The token figure a readout shows, e.g. `29.5k` or `900`; `null` when there is no figure. */
function tokenFigure(text: string | null): number | null {
  const match = /^([\d.]+)(k?)\s*\//.exec(text?.trim() ?? "");
  if (match?.[1] === undefined) {
    return null;
  }
  const value = Number(match[1]);
  return match[2] === "k" ? value * 1_000 : value;
}

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script, seed: SeedName = "plain"): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, seed);
  await mkdir(home.agentDir, { recursive: true });
  await writeFile(
    join(home.agentDir, "settings.json"),
    `${JSON.stringify(COMPACTION_SETTINGS, null, 2)}\n`,
    "utf8",
  );
  const launch = await scriptedPiLaunch(home, script);
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
  });
  const client = await startClientPageServer();
  return { home, seeded, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText("Seed text block");
}

function readout(page: Page) {
  return page.getByTestId("context-usage");
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

/** The compaction boundaries one frame announces, if any. */
function boundaryEntries(message: ServerMessage | null): readonly CompactionBoundaryEntry[] {
  if (message === null || message.type !== "delta") {
    return [];
  }
  return message.deltas.flatMap((delta) =>
    delta.kind === ProjectionDeltaKind.EntryUpsert &&
    delta.entry.kind === EntryKind.CompactionBoundary
      ? [delta.entry]
      : [],
  );
}

function compactingAt(frames: readonly ServerMessage[]): number {
  return frames.findIndex(
    (message) =>
      message.type === "delta" &&
      message.deltas.some(
        (delta) =>
          delta.kind === ProjectionDeltaKind.RunState && delta.runState.kind === "compacting",
      ),
  );
}

function boundaryAt(frames: readonly ServerMessage[]): number {
  return frames.findIndex((message) => boundaryEntries(message).length > 0);
}

/** The first context figure after `from`, which is the one pi reports once the compaction ended. */
function usageAfter(
  frames: readonly ServerMessage[],
  from: number,
): ContextUsage | null | undefined {
  const message = frames.slice(from + 1).find((frame) => frame.type === "contextUsage");
  return message?.type === "contextUsage" ? message.contextUsage : undefined;
}

/** The first context figure a Session reports, which every attach sends. */
function usageIn(frames: readonly ServerMessage[]): ContextUsage | null | undefined {
  const message = frames.find((frame) => frame.type === "contextUsage");
  return message?.type === "contextUsage" ? message.contextUsage : undefined;
}

test("a Session pi already compacted shows its boundary straight from the Session file", async ({
  page,
}) => {
  const harness = await startHarness(compactionSteps(), "compaction");
  try {
    await openHarness(page, harness);

    // The boundary comes from pi's own entry, not from a Delta this server happened to have sent.
    const boundary = page.getByTestId("compaction-boundary");
    await expect(boundary).toHaveCount(1);
    await expect(boundary).toContainText("Seed compaction summary");
    await expect(page.getByTestId("compaction-boundary-label")).toHaveText(
      "Context compacted here",
    );
    await expect(boundary.locator("svg")).toHaveAttribute("data-icon", "arrow-down-to-line");

    // The figure is pi's measurement of the compacted session, so the readout is a percentage.
    await expect(readout(page)).toHaveAttribute("data-state", "normal");
  } finally {
    await disposeHarness(harness);
  }
});

test("compaction from the palette leaves a boundary and clears the context readout", async ({
  page,
}) => {
  const harness = await startHarness(compactionSteps());
  try {
    await openHarness(page, harness);

    // A seeded conversation pi can measure: the figure is a percentage, not a recalculation.
    await expect(readout(page)).toHaveAttribute("data-state", "normal");
    const before = tokenFigure(await readout(page).textContent());

    // The palette lists the built-in and completing it only fills the composer in.
    await page.getByTestId("composer-input").fill("/");
    await page.locator('[data-entry-key="builtin:compact"]').click();
    await expect(page.getByTestId("composer-input")).toHaveValue("/compact ");
    await expect(page.getByTestId("compaction-boundary")).toHaveCount(0);

    await page.getByTestId("composer-send").click();

    const boundary = page.getByTestId("compaction-boundary");
    await expect(boundary).toHaveCount(1);
    await expect(page.getByTestId("compaction-boundary-label")).toHaveText(
      "Context compacted here",
    );
    await expect(boundary).toContainText(SUMMARY);
    expect(Number(await boundary.getAttribute("data-tokens-before"))).toBeGreaterThan(0);

    // pi has no figure until a model call gives it one, so a follow-up turn is what lets the readout
    // stop recalculating. A readout stuck on "Recalculating…" forever must fail this, not pass it.
    await send(page, MEASURE_AFTER_COMPACTION_PROMPT);
    await expect(page.getByTestId("transcript")).toContainText(MEASURE_AFTER_COMPACTION_REPLY);
    await expect
      .poll(
        async () => {
          const state = await readout(page).getAttribute("data-state");
          return state === "recalculating" || state === "unavailable"
            ? null
            : tokenFigure(await readout(page).textContent());
        },
        { timeout: 30_000 },
      )
      .not.toBeNull();
    const after = tokenFigure(await readout(page).textContent());
    expect(after).not.toBeNull();
    expect(after).toBeLessThan(before ?? 0);
  } finally {
    await disposeHarness(harness);
  }
});

test("compaction typed with instructions reaches pi as the summary's focus", async ({ page }) => {
  const harness = await startHarness(instructionCompactionSteps());
  try {
    await openHarness(page, harness);

    // A second turn, long enough to sit above pi's keep-recent budget, so the compaction covers the
    // first turn as history. Only a history summary is asked for with the user's focus.
    await send(page, "add a note");
    await expect(page.getByTestId("transcript")).toContainText(NOTE_REPLY_START);

    await send(page, "/compact keep the API surface");

    // The scripted summary call refuses a focus it never recorded, so the boundary proves the
    // instructions pi summarized with were the ones typed.
    await expect(page.getByTestId("compaction-boundary")).toContainText(HISTORY_SUMMARY);
  } finally {
    await disposeHarness(harness);
  }
});

test("the Session reports compaction in progress before the boundary and the remeasured figure", async () => {
  const harness = await startHarness(compactionSteps());
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({ type: "subscribe", sessionId: harness.seeded.id });
    expect((await client.next()).type).toBe("snapshot");

    const frames: ServerMessage[] = [];
    while (usageIn(frames) === undefined) {
      frames.push(await client.next());
    }
    const before = usageIn(frames);

    client.send({ type: "compact", sessionId: harness.seeded.id });

    // The order is the point, so it is read from the stream rather than timed in a browser: a
    // compaction is reported as running, then as a boundary, then with pi's remeasured figure.
    for (let read = 0; read < 200; read += 1) {
      const boundary = boundaryAt(frames);
      if (
        compactingAt(frames) !== -1 &&
        boundary !== -1 &&
        usageAfter(frames, boundary) !== undefined
      ) {
        break;
      }
      frames.push(await client.next());
    }

    expect(compactingAt(frames)).toBeGreaterThan(-1);
    expect(boundaryAt(frames)).toBeGreaterThan(compactingAt(frames));
    const after = usageAfter(frames, boundaryAt(frames));
    if (after === undefined) {
      throw new Error("no context figure followed the compaction boundary");
    }
    // pi has re-read the figure: it is recomputing, or it measured the summary plus what it kept,
    // which is less context than the pre-compaction figure.
    expect(after === null || after.tokens === null || after.tokens < (before?.tokens ?? 0)).toBe(
      true,
    );

    const boundary = boundaryEntries(frames[boundaryAt(frames)] ?? null)[0];
    expect(boundary?.summary).toContain(SUMMARY);
    expect(boundary?.tokensBefore).toBeGreaterThan(0);
    expect(boundary?.firstKeptEntryId).not.toBe("");
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

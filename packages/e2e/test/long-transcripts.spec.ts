import { expect, test, type Locator, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { generateSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";
import { readUntilText } from "../src/ws-transcript";

const PI_TEST_TIMEOUT_MS = 120_000;
test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/**
 * The mounted-row bound is a literal, not the client's exported constant: reading the constant would
 * let a change to it pass this spec by construction, and the bound is the claim under test.
 */
const WINDOW_SIZE = 60;
/** The client's own load of an already-seeded Session, in ms; see the measurement the spec prints. */
const LOAD_BUDGET_MS = 3_000;
const MIN_ENTRIES = 500;
/** Raw generated turns; the projected transcript drops folded tool results, so a margin over 500. */
const LARGE_ENTRIES = 600;
/** Comfortably inside the window, so a streaming reply cannot push a mounted row out. */
const SMALL_ENTRIES = 40;

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this session never sends" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

const STREAM_PROMPT = "stream a reply";
const STREAM_REPLY = "A streamed answer that arrives in several deltas.";

const STREAM_SCRIPT: Script = [
  {
    expect: { role: "user", text: STREAM_PROMPT },
    reply: { content: [{ type: "text", text: STREAM_REPLY }], stopReason: "stop" },
  },
];

const AWAY_PROMPT = "produce output while away";
const AWAY_REPLY = "output produced while away";

const AWAY_SCRIPT: Script = [
  {
    expect: { role: "user", text: AWAY_PROMPT },
    reply: { content: [{ type: "text", text: AWAY_REPLY }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly session: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script, transcriptEntries: number): Promise<Harness> {
  const home = await createHermeticHome();
  const session = await generateSession(home, "transcript", { transcriptEntries });
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
  return { home, session, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

function sessionUrl(harness: Harness): string {
  return `${harness.client.url}?session=${encodeURIComponent(harness.session.id)}&ws=${encodeURIComponent(harness.server.url)}`;
}

async function openHarness(page: Page, harness: Harness): Promise<void> {
  await page.goto(sessionUrl(harness));
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  // The Snapshot is one message, so the first mounted row means the whole window rendered; an early
  // turn's text is hidden by the window on a long Session.
  await expect(page.getByTestId("transcript-entry").first()).toBeVisible({
    timeout: PI_TEST_TIMEOUT_MS,
  });
}

/** How many entry rows are mounted. */
async function mountedRows(page: Page): Promise<number> {
  return await page.getByTestId("transcript-entry").count();
}

async function scrollTopOf(transcript: Locator): Promise<number> {
  return await transcript.evaluate((element) => (element as HTMLElement).scrollTop);
}

/** Scroll and let the next frames run, so the component's own scroll handler sees the new position. */
async function scrollTo(transcript: Locator, top: number | "top" | "bottom"): Promise<void> {
  await transcript.evaluate(async (element, position) => {
    const container = element as HTMLElement;
    container.scrollTop =
      position === "top" ? 0 : position === "bottom" ? container.scrollHeight : position;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }, top);
}

test("a 500+ entry Session loads within the budget with a bounded, scrolling window", async ({
  page,
}) => {
  const harness = await startHarness(UNUSED_SCRIPT, LARGE_ENTRIES);
  try {
    // The first open starts the Pi child and seeds the Projection; the reload then measures the
    // client's own load and render of that Snapshot rather than pi's startup.
    await openHarness(page, harness);
    await page.reload();
    const loadMs = await page.evaluate(async (windowSize) => {
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (document.querySelectorAll('[data-testid="transcript-entry"]').length === windowSize) {
            resolve();
            return;
          }
          setTimeout(check, 5);
        };
        check();
      });
      return performance.now();
    }, WINDOW_SIZE);
    process.stderr.write(`[e2e] 500+ entry transcript loaded in ${String(Math.round(loadMs))}ms\n`);
    expect(loadMs).toBeLessThanOrEqual(LOAD_BUDGET_MS);

    const transcript = page.getByTestId("transcript");
    await expect(page.getByTestId("hidden-older")).toBeVisible();
    const hidden = Number(await page.getByTestId("hidden-older").getAttribute("data-hidden-count"));
    expect(hidden + (await mountedRows(page))).toBeGreaterThanOrEqual(MIN_ENTRIES);
    expect(await mountedRows(page)).toBe(WINDOW_SIZE);

    // Scrolling within the transcript changes the pixels the reader sees, never the row count.
    await scrollTo(transcript, "top");
    expect(await mountedRows(page)).toBe(WINDOW_SIZE);
    await scrollTo(transcript, "bottom");
    expect(await mountedRows(page)).toBe(WINDOW_SIZE);
  } finally {
    await disposeHarness(harness);
  }
});

test("a streaming Delta updates text without remounting the mounted rows", async ({ page }) => {
  const harness = await startHarness(STREAM_SCRIPT, SMALL_ENTRIES);
  try {
    await openHarness(page, harness);
    const transcript = page.getByTestId("transcript");

    const before = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="transcript-entry"]')];
      // A JS property, not an attribute: a re-created element cannot carry it, so a remount shows up
      // as a missing mark.
      for (const row of rows) {
        (row as unknown as { __mark?: string }).__mark = "kept";
      }
      const state = { added: 0, removed: 0 };
      (window as unknown as { __rowWatch?: typeof state }).__rowWatch = state;
      const isRow = (node: Node): boolean =>
        node instanceof Element && node.matches('[data-testid="transcript-entry"]');
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (isRow(node)) {
              state.added += 1;
            }
          }
          for (const node of record.removedNodes) {
            if (isRow(node)) {
              state.removed += 1;
            }
          }
        }
      }).observe(document.querySelector('[data-testid="transcript"]') as Element, {
        childList: true,
        subtree: true,
      });
      return rows.map((row) => row.dataset["entryId"] ?? "");
    });
    expect(before.length).toBeGreaterThan(0);

    await page.getByTestId("composer-input").fill(STREAM_PROMPT);
    await page.getByTestId("composer-send").click();
    await expect(transcript).toContainText(STREAM_REPLY);

    const result = await page.evaluate((ids) => {
      const state = (window as unknown as { __rowWatch: { added: number; removed: number } })
        .__rowWatch;
      const kept = ids.every((id) => {
        const row = document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`);
        return row !== null && (row as unknown as { __mark?: string }).__mark === "kept";
      });
      const replyRows = [
        ...document.querySelectorAll<HTMLElement>('[data-testid="transcript-entry"]'),
      ].filter((row) => row.textContent?.includes("streamed answer")).length;
      return { ...state, kept, replyRows };
    }, before);

    process.stderr.write(
      `[e2e] streaming delta: rows added ${String(result.added)}, removed ${String(result.removed)}, ` +
        `reply rows ${String(result.replyRows)}\n`,
    );
    expect(result.removed).toBe(0);
    expect(result.kept).toBe(true);
    // The reply is one row that grew in place, not a row per Delta.
    expect(result.replyRows).toBe(1);
  } finally {
    await disposeHarness(harness);
  }
});

test("preserves the reader's scroll position across a reconnect and Delta replay", async ({
  page,
}) => {
  const harness = await startHarness(AWAY_SCRIPT, SMALL_ENTRIES);
  try {
    await openHarness(page, harness);
    const transcript = page.getByTestId("transcript");
    const metrics = await transcript.evaluate((element) => {
      const container = element as HTMLElement;
      return { scrollHeight: container.scrollHeight, clientHeight: container.clientHeight };
    });
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await scrollTo(transcript, Math.floor((metrics.scrollHeight - metrics.clientHeight) / 2));
    const before = await scrollTopOf(transcript);
    expect(before).toBeGreaterThan(0);

    harness.server.dropViewerConnections();
    await expect(page.getByTestId("connection-status")).toHaveAttribute(
      "data-status",
      "reconnecting",
    );

    // Output produced by another viewer while this page is down: the only way for the page to show
    // it is the reconnect's replay from its Cursor.
    const writer = await connectWsSession(harness.server.url);
    try {
      writer.send({ type: "subscribe", sessionId: harness.session.id });
      await writer.next();
      writer.send({ type: "prompt", sessionId: harness.session.id, text: AWAY_PROMPT });
      await readUntilText(writer, AWAY_REPLY);
    } finally {
      await writer.close();
    }

    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(transcript).toContainText(AWAY_REPLY);
    expect(await scrollTopOf(transcript)).toBe(before);
  } finally {
    await disposeHarness(harness);
  }
});

import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createManualClock, type ManualClock } from "../src/manual-clock";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { piChildPids } from "../src/pi-processes";

const PI_START_TIMEOUT_MS = 30_000;
/** Short enough that a spec advances past it by hand instead of a test taking minutes. */
const IDLE_TIMEOUT_MS = 60_000;

// Neither seeded Session asks the model anything, but pi still has to be launched with a model it
// can resolve, and the scripted provider is the only model substitute the suite has.
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

const NAMED_TITLE = "Seed session 1";
const UNNAMED_TITLE = "Seed text block 2.";
const NAMED_MARKER = "Seed text block 54.";
const UNNAMED_MARKER = "Seed text block 32.";

interface Harness {
  readonly home: HermeticHome;
  readonly named: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
  readonly clock: ManualClock;
}

async function startHarness(options: { readonly keepAlive?: boolean } = {}): Promise<Harness> {
  const home = await createHermeticHome();
  const named = await seedSession(home, "plain");
  await seedSession(home, "branching");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const clock = createManualClock();
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
    clock: clock.clock,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    ...(options.keepAlive === true ? { keepAlive: true } : {}),
  });
  const client = await startClientPageServer();
  return { home, named, server, client, clock };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

async function openHarness(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.named.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(NAMED_MARKER, {
    timeout: PI_START_TIMEOUT_MS,
  });
}

/** Switch the watched Session through the drawer, which leaves the previous one with no viewer. */
async function switchTo(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
  await page.getByTestId("session-row").filter({ hasText: title }).click();
  await page.getByRole("button", { name: "Close sessions sidebar" }).click();
}

test("an idle, unwatched Session's Pi child is evicted after the timeout and respawns when opened", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);
    await expect.poll(() => piChildPids().length).toBe(1);
    const namedChild = piChildPids()[0];
    if (namedChild === undefined) {
      throw new Error("opening the Session started no Pi child");
    }

    // The watched Session can never be evicted, so watching moves to the other one.
    await switchTo(page, UNNAMED_TITLE);
    await expect(page.getByTestId("transcript")).toContainText(UNNAMED_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect.poll(() => piChildPids().length).toBe(2);

    harness.clock.advance(IDLE_TIMEOUT_MS - 1);
    // Not before the timeout: the Session still owns the child it started with.
    expect(piChildPids()).toContain(namedChild);

    harness.clock.advance(1);
    await expect.poll(() => piChildPids().length).toBe(1);
    expect(piChildPids()).not.toContain(namedChild);

    // Opening it again respawns from the intact Session file, so the transcript is all there.
    await switchTo(page, NAMED_TITLE);
    await expect(page.getByTestId("transcript")).toContainText(NAMED_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect.poll(() => piChildPids().length).toBe(2);
    expect(piChildPids()).not.toContain(namedChild);
  } finally {
    await disposeHarness(harness);
  }
});

test("keep-alive keeps an unwatched Session's Pi child, however long it sits", async ({ page }) => {
  const harness = await startHarness({ keepAlive: true });
  try {
    await openHarness(page, harness);
    await expect.poll(() => piChildPids().length).toBe(1);
    const namedChild = piChildPids()[0];
    if (namedChild === undefined) {
      throw new Error("opening the Session started no Pi child");
    }

    await switchTo(page, UNNAMED_TITLE);
    await expect(page.getByTestId("transcript")).toContainText(UNNAMED_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    harness.clock.advance(IDLE_TIMEOUT_MS * 10);
    expect(piChildPids()).toContain(namedChild);
    expect(piChildPids()).toHaveLength(2);

    // Still the same child, so reopening is instant rather than a respawn.
    await switchTo(page, NAMED_TITLE);
    await expect(page.getByTestId("transcript")).toContainText(NAMED_MARKER);
    expect(piChildPids()).toContain(namedChild);
  } finally {
    await disposeHarness(harness);
  }
});

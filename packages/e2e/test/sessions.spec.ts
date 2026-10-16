import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;
const PI_START_TIMEOUT_MS = 30_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

// Neither seeded Session asks the model anything, but pi still has to be launched with a model it
// can resolve, and the scripted provider is the only model substitute the suite has.
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** The named seed's row title; the unnamed seed's row title is its first user message. */
const NAMED_TITLE = "Seed session 1";
const UNNAMED_TITLE = "Seed text block 2.";
/** Text only each seed's own active path carries, so a transcript's owner is unambiguous. */
const NAMED_MARKER = "Seed text block 54.";
const UNNAMED_MARKER = "Seed text block 32.";

interface Harness {
  readonly home: HermeticHome;
  readonly named: FixtureSession;
  readonly unnamed: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const named = await seedSession(home, "plain");
  const unnamed = await seedSession(home, "branching");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
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
  return { home, named, unnamed, server, client };
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

test("the drawer lists this project's Sessions with name, first message and recency", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);

    // Collapsed by default.
    await expect(page.getByTestId("session-drawer")).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    await expect(page.getByTestId("session-drawer")).toBeVisible();

    const rows = page.getByTestId("session-row");
    await expect(rows).toHaveCount(2);

    const namedRow = rows.filter({ hasText: NAMED_TITLE });
    const unnamedRow = rows.filter({ hasText: UNNAMED_TITLE });
    // The unnamed Session falls back to the first line of its first message, not its id.
    await expect(namedRow.getByTestId("session-name")).toHaveText(NAMED_TITLE);
    await expect(unnamedRow.getByTestId("session-name")).toHaveText(UNNAMED_TITLE);

    // The seeded files are old, so the label reads in whole days.
    await expect(namedRow.getByTestId("session-time")).toHaveText(/^\d+d ago$/);
    await expect(unnamedRow.getByTestId("session-time")).toHaveText(/^\d+d ago$/);

    // The open Session is marked current.
    await expect(namedRow).toHaveAttribute("aria-current", "true");
    await expect(unnamedRow).not.toHaveAttribute("aria-current", "true");

    // pi owns the files: the UI offers no rename or delete.
    const drawer = page.getByTestId("session-drawer");
    await expect(drawer.getByRole("button", { name: /rename|delete/i })).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

test("tapping a row switches the transcript and starts that Session lazily", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);

    // The other Session has a row but its transcript is not loaded: no child runs for it yet.
    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    await expect(page.getByTestId("transcript")).not.toContainText(UNNAMED_MARKER);

    const unnamedRow = page.getByTestId("session-row").filter({ hasText: UNNAMED_TITLE });
    await unnamedRow.click();

    // Its own child starts from its session file and its transcript replaces the previous one.
    await expect(page.getByTestId("transcript")).toContainText(UNNAMED_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).not.toContainText(NAMED_MARKER);
    await expect(unnamedRow).toHaveAttribute("aria-current", "true");

    // Switching back loads the first Session's transcript again, in full.
    const namedRow = page.getByTestId("session-row").filter({ hasText: NAMED_TITLE });
    await namedRow.click();
    await expect(page.getByTestId("transcript")).toContainText(NAMED_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).not.toContainText(UNNAMED_MARKER);
    await expect(namedRow).toHaveAttribute("aria-current", "true");
  } finally {
    await disposeHarness(harness);
  }
});

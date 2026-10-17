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

/** A run that stays live on a bash tool, so a switch away happens while the first Session works. */
const BACKGROUND_SCRIPT: Script = [
  {
    expect: { role: "user", text: "run the slow background command" },
    reply: {
      content: [
        { type: "text", text: "starting the background run" },
        {
          type: "toolCall",
          id: "call_background_1",
          name: "bash",
          arguments: { command: "sleep 10", timeout: 30 },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "bash" },
    reply: { content: [{ type: "text", text: "background run finished" }], stopReason: "stop" },
  },
];

/**
 * Two turns of the same prompt with different replies. A second Session that shares the first's Pi
 * child replays step two on its own first prompt, so the recording tells the two apart.
 */
const PER_CHILD_SCRIPT: Script = [
  {
    expect: { role: "user", text: "hello there" },
    reply: { content: [{ type: "text", text: "first reply" }], stopReason: "stop" },
  },
  {
    expect: { role: "user", text: "hello there" },
    reply: { content: [{ type: "text", text: "second reply" }], stopReason: "stop" },
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

async function startHarness(script: Script = UNUSED_SCRIPT): Promise<Harness> {
  const home = await createHermeticHome();
  const named = await seedSession(home, "plain");
  const unnamed = await seedSession(home, "branching");
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

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
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

test("the plus control opens a new Session with a server-generated id", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);
    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    await page.getByTestId("new-session-action").click();

    // The client never named an id, so the id the shell opens is the server's own.
    const shell = page.getByTestId("app-shell");
    await expect(shell).not.toHaveAttribute("data-session-id", harness.named.id);
    const created = await shell.getAttribute("data-session-id");
    expect(created).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The fresh Session is empty, so the Session it replaced left nothing behind.
    await expect(page.getByTestId("transcript")).not.toContainText(NAMED_MARKER);
  } finally {
    await disposeHarness(harness);
  }
});

test("a background Session keeps running and its output is there on return", async ({ page }) => {
  const harness = await startHarness(BACKGROUND_SCRIPT);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "run the slow background command");
    await expect(page.getByTestId("transcript")).toContainText("starting the background run");

    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    const namedRow = page.getByTestId("session-row").filter({ hasText: NAMED_TITLE });
    const unnamedRow = page.getByTestId("session-row").filter({ hasText: UNNAMED_TITLE });
    await unnamedRow.click();
    await expect(page.getByTestId("transcript")).toContainText(UNNAMED_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    // The Session we left is still working, and its row says so.
    await expect(namedRow).toHaveAttribute("data-activity", "working");
    await expect(namedRow.getByTestId("activity-dot")).toBeVisible();

    // Returning shows the output produced while we were away, and reading it clears the dot.
    await namedRow.click();
    await expect(page.getByTestId("transcript")).toContainText("background run finished", {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(namedRow.getByTestId("activity-dot")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

test("two Sessions run in separate Pi children and never share a transcript", async ({ page }) => {
  const harness = await startHarness(PER_CHILD_SCRIPT);
  try {
    await openHarness(page, harness);
    await sendMessage(page, "hello there");
    await expect(page.getByTestId("transcript")).toContainText("first reply");

    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    const unnamedRow = page.getByTestId("session-row").filter({ hasText: UNNAMED_TITLE });
    await unnamedRow.click();
    await expect(page.getByTestId("transcript")).toContainText(UNNAMED_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    // The drawer overlays the composer, so it has to be closed before the next send.
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();

    // The second Session's first prompt is its own child's first model call: it gets the first
    // reply, not the one the first Session would have consumed next.
    await sendMessage(page, "hello there");
    await expect(page.getByTestId("transcript")).toContainText("first reply");
    await expect(page.getByTestId("transcript")).not.toContainText("second reply");
  } finally {
    await disposeHarness(harness);
  }
});

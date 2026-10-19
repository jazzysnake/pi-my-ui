import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const DOWNLOAD_TIMEOUT_MS = 10_000;

/** One prompt template in the hermetic workspace, so the palette has a pi command to list. */
const PROMPT_TEMPLATE = "---\ndescription: Review the working tree\n---\nReview the diff: $@\n";

/** A prompt the model is allowed to answer; every other prompt fails loudly. */
const UNKNOWN_COMMAND_SCRIPT: Script = [
  {
    expect: { role: "user", text: "/notacommand" },
    reply: {
      content: [{ type: "text", text: "the model saw the unknown command" }],
      stopReason: "stop",
    },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

/**
 * Start a server whose Pi child loads prompt templates from the workspace. `scriptedPiLaunch`
 * disables them for recordings, so the flag is dropped here to give the palette one real pi command
 * to list beside the built-ins.
 */
async function startHarness(script: Script): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, script);
  await mkdir(join(launch.cwd, ".pi", "prompts"), { recursive: true });
  await writeFile(join(launch.cwd, ".pi", "prompts", "review.md"), PROMPT_TEMPLATE, "utf8");
  const args = launch.args.filter((arg) => arg !== "--no-prompt-templates");
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args,
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
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("the palette lists built-ins and pi's prompt templates, filters, and inserts without sending", async ({
  page,
}) => {
  const harness = await startHarness(UNKNOWN_COMMAND_SCRIPT);
  try {
    await openHarness(page, harness);
    const input = page.getByTestId("composer-input");

    await input.fill("/");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(page.locator('[data-entry-key="builtin:tree"]')).toContainText("/tree");
    await expect(page.locator('[data-entry-key="builtin:tree"]')).toContainText("built-in");
    // A prompt template from the workspace, badged with pi's own source.
    await expect(page.locator('[data-entry-key="prompt:review"]')).toContainText("/review");
    await expect(page.locator('[data-entry-key="prompt:review"]')).toContainText(
      "Review the working tree",
    );

    // Fuzzy filtering keeps only the row that matches every typed character in order.
    await input.fill("/cmp");
    await expect(page.locator('[data-entry-key="builtin:compact"]')).toBeVisible();
    await expect(page.locator('[data-entry-key="builtin:tree"]')).toHaveCount(0);

    // Choosing a row completes it and runs nothing: the composer holds the command and its trailing
    // space, the palette is gone, and the model never saw a prompt.
    await input.fill("/");
    await page.locator('[data-entry-key="prompt:review"]').click();
    await expect(input).toHaveValue("/review ");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(page.getByTestId("transcript")).not.toContainText("/review");

    // A pi TUI-only command is refused with a message and never reaches the model.
    await send(page, "/settings");
    await expect(page.getByTestId("composer-error")).toContainText("/settings");
    await expect(page.getByTestId("composer-error")).toContainText("TUI-only");
    await expect(page.getByTestId("transcript")).not.toContainText("/settings");

    // An unrecognised slash command is forwarded to pi exactly as written.
    await send(page, "/notacommand");
    await expect(page.getByTestId("transcript")).toContainText("/notacommand");
    await expect(page.getByTestId("transcript")).toContainText("the model saw the unknown command");
  } finally {
    await disposeHarness(harness);
  }
});

test("/resume opens the list, /name renames, /session shows pi's statistics, /export downloads", async ({
  page,
}) => {
  const harness = await startHarness(UNKNOWN_COMMAND_SCRIPT);
  try {
    await openHarness(page, harness);

    // `/resume` is the drawer's own open action.
    await send(page, "/resume");
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await page.getByTestId("session-row").first().waitFor();
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();

    // A bare `/name` reports pi's current name, read from the server's own index.
    await send(page, "/name");
    await expect(page.getByTestId("command-notice")).toHaveText(
      "Current session name: Seed session 1",
    );

    // With an argument it renames, and the drawer row is refreshed from the server.
    await send(page, "/name Renamed from the phone");
    await expect(page.getByTestId("command-notice")).toHaveText(
      'Session renamed to "Renamed from the phone".',
    );
    await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
    await expect(
      page
        .locator(`[data-testid="session-row"][data-session-id="${harness.seeded.id}"]`)
        .getByTestId("session-name"),
    ).toHaveText("Renamed from the phone");
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();

    // `/session` shows pi's numbers; a missing context figure reads as unavailable, never zero.
    await send(page, "/session");
    const panel = page.getByTestId("session-stats-panel");
    await expect(panel).toBeVisible();
    const valueFor = (key: string) =>
      panel.locator(`[data-stat="${key}"] [data-testid="session-stats-value"]`);
    await expect(valueFor("session-id")).toHaveText(harness.seeded.id);
    await expect(valueFor("cost")).toContainText("$");
    await expect(valueFor("context")).not.toHaveText("0");

    // `/export` writes pi's HTML inside the served directory and starts the download itself: one
    // command, one download, and no second control to tap.
    const downloadPromise = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
    await send(page, "/export");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.html$/);
    await expect(page.getByTestId("session-export-path")).toContainText(".html");
    await expect(page.getByTestId("session-export-download")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

test("/new opens a Session with a server-generated id", async ({ page }) => {
  const harness = await startHarness(UNKNOWN_COMMAND_SCRIPT);
  try {
    await openHarness(page, harness);
    const shell = page.getByTestId("app-shell");

    await send(page, "/new");
    await expect(shell).not.toHaveAttribute("data-session-id", harness.seeded.id);
    const created = await shell.getAttribute("data-session-id");
    expect(created).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  } finally {
    await disposeHarness(harness);
  }
});

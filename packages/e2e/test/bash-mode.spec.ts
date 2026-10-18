import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const SECRET_SENTINEL = "TOP_SECRET_SENTINEL_42";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, script);
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
  await expect(page.getByTestId("transcript-entry").first()).toBeVisible();
}

async function sendCommand(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

const NO_MODEL_CALL: Script = [
  {
    expect: { role: "user", text: "unused" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

test("states the bash mode before the command is sent", async ({ page }) => {
  const harness = await startHarness(NO_MODEL_CALL);
  try {
    await openHarness(page, harness);
    const input = page.getByTestId("composer-input");

    await input.fill("!echo hello");
    const include = page.getByTestId("bash-mode-indicator");
    await expect(include).toHaveAttribute("data-bash-mode", "include");
    await expect(include).toContainText("adds to context");
    await expect(include).toContainText(
      "The output will enter the model's context on the next prompt.",
    );

    await input.fill("!!echo secret");
    const exclude = page.getByTestId("bash-mode-indicator");
    await expect(exclude).toHaveAttribute("data-bash-mode", "exclude");
    await expect(exclude).toContainText("not added to context");
    await expect(exclude).toContainText("The output will not enter the model's context.");
  } finally {
    await disposeHarness(harness);
  }
});

test("streams the command's output live and ends with its exit code", async ({ page }) => {
  const harness = await startHarness(NO_MODEL_CALL);
  try {
    await openHarness(page, harness);

    await sendCommand(page, "!echo first; sleep 3; echo second");

    const card = page.getByTestId("bash-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-bash-status", "running");
    // The first line arrives while the command is still sleeping: output is streamed, not rendered
    // only once pi answers.
    await expect(card.getByTestId("bash-output")).toContainText("first");
    await expect(card.getByTestId("bash-output")).not.toContainText("second");

    await expect(card.getByTestId("bash-output")).toContainText("second");
    await expect(card).toHaveAttribute("data-bash-status", "ok");
    await expect(card.getByTestId("bash-exit")).toHaveText("Exit code 0");
    await expect(card.getByTestId("bash-command")).toHaveText("echo first; sleep 3; echo second");
    await expect(card.getByTestId("bash-mode-label")).toHaveText("! adds to context");
  } finally {
    await disposeHarness(harness);
  }
});

test("shows a non-zero exit as an error", async ({ page }) => {
  const harness = await startHarness(NO_MODEL_CALL);
  try {
    await openHarness(page, harness);
    await sendCommand(page, "!exit 3");

    const card = page.getByTestId("bash-card");
    await expect(card).toHaveAttribute("data-bash-status", "error");
    await expect(card.getByTestId("bash-exit")).toHaveText("Exit code 3");
  } finally {
    await disposeHarness(harness);
  }
});

test("the bash card survives a dropped connection and resync", async ({ page }) => {
  const harness = await startHarness(NO_MODEL_CALL);
  try {
    await openHarness(page, harness);
    await sendCommand(page, "!echo survive-resync");

    const card = page.getByTestId("bash-card");
    await expect(card).toHaveAttribute("data-bash-status", "ok");
    await expect(card.getByTestId("bash-output")).toContainText("survive-resync");

    expect(harness.server.dropViewerConnections()).toBeGreaterThan(0);
    await expect(page.getByTestId("connection-status")).toHaveAttribute(
      "data-status",
      "reconnecting",
    );
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    // One card, unchanged: the resync re-sends the projected execution rather than re-creating it.
    await expect(page.getByTestId("bash-card")).toHaveCount(1);
    await expect(card.getByTestId("bash-command")).toHaveText("echo survive-resync");
    await expect(card.getByTestId("bash-output")).toContainText("survive-resync");
    await expect(card.getByTestId("bash-exit")).toHaveText("Exit code 0");
  } finally {
    await disposeHarness(harness);
  }
});

test("`!!` output never enters the model's context", async ({ page }) => {
  const harness = await startHarness([
    {
      expect: {
        role: "user",
        text: "what do you see?",
        contextExcludes: SECRET_SENTINEL,
      },
      reply: { content: [{ type: "text", text: "I see no secret." }], stopReason: "stop" },
    },
  ]);
  try {
    await openHarness(page, harness);
    await sendCommand(page, `!!echo ${SECRET_SENTINEL}`);

    const card = page.getByTestId("bash-card");
    await expect(card).toHaveAttribute("data-bash-mode", "exclude");
    await expect(card).toHaveAttribute("data-bash-status", "ok");
    await expect(card.getByTestId("bash-output")).toContainText(SECRET_SENTINEL);

    await sendCommand(page, "what do you see?");

    // The scripted provider fails the run if the sentinel reaches the model, so a reply is proof the
    // output stayed out of the context.
    await expect(page.getByTestId("transcript")).toContainText("I see no secret.");
    await expect(page.getByTestId("run-state")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

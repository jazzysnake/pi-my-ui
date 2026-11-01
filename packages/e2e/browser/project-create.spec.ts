import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

// The create journey needs no model call, but starting a Session still launches pi, which needs a
// model it can resolve; the scripted provider is the only substitute the suite has.
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly workspace: string;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

/** A real server anchored to an empty Workspace, so the picker has nothing to list. */
async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [],
    workspace: home.workspace,
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
  return { home, workspace: home.workspace, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

async function openBarePage(page: Page, harness: Harness): Promise<void> {
  await page.goto(`${harness.client.url}?ws=${encodeURIComponent(harness.server.url)}`);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

// Wiring claim: the name field taking focus on open is a real layout engine's fact, which is what
// admits this spec; the refusal line and the Session start are the same journey rather than a second
// one, so they stay in it.
test("a phone creates a Project from an empty Workspace and starts a Session in it", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openBarePage(page, harness);
    await expect(page.getByTestId("project-empty")).toContainText(harness.workspace);

    await page.getByTestId("create-project-empty").click();
    const name = page.getByTestId("project-name-input");
    // The sheet opens already typing, rather than making a phone wait for a second tap.
    await expect(name).toBeFocused();

    await name.fill("two/levels");
    await page.getByTestId("project-name-create").click();
    await expect(page.getByTestId("project-name-error")).toHaveCount(1);
    await expect(page.getByTestId("project-name-error")).toBeVisible();
    await expect(name).toHaveValue("two/levels");

    await name.fill("fresh");
    await page.getByTestId("project-name-create").click();

    // The created Project is chosen by its own answer, and its empty Session list is the next screen.
    await expect(page.getByTestId("project-name-sheet")).toHaveCount(0);
    await expect(page.getByTestId("project-picker")).toHaveCount(0);
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("session-list-empty")).toBeVisible();
    await expect(page.getByTestId("current-project-label")).toHaveText("fresh");

    await page.getByTestId("new-session-action").click();
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-session-id", /^[0-9a-f]{8}-/);
  } finally {
    await disposeHarness(harness);
  }
});

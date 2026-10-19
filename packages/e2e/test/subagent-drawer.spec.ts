import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, writeParentedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

// No test here asks the model anything, but pi still has to be launched with a model it can
// resolve, and the scripted provider is the only model substitute the suite has.
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** The first eight characters of a run id, which is the tail pi-subagents puts in a child's name. */
const RUN_ID_PREFIX = "3f9c1a7e";
/** The name pi-subagents gives a run's child session: `<agent type>#<run id prefix>`. */
const SUBAGENT_CHILD_NAME = `general-purpose#${RUN_ID_PREFIX}`;
/** The owner's own fork, which pi also points at its parent Session. */
const OWNER_FORK_NAME = "Owner fork";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
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

/** Open the seeded Session and the drawer, so the list under test has been requested. */
async function openDrawer(page: Page, harness: Harness): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await page.getByRole("button", { name: "Toggle sessions sidebar" }).click();
  await expect(page.getByTestId("session-drawer")).toBeVisible();
}

function rowOf(page: Page, session: FixtureSession): ReturnType<Page["locator"]> {
  return page.locator(`[data-testid="session-row"][data-session-id="${session.id}"]`);
}

// Wiring claim: a run's child Session is hidden from the drawer while the owner's own fork stays listed.
test("the drawer hides a subagent child and keeps the owner's own fork", async ({ page }) => {
  const harness = await startHarness();
  try {
    // Both carry the spawning Session in their header, as pi writes a parent for both.
    const fork = await writeParentedSession(harness.home, {
      parentSessionPath: harness.seeded.path,
      name: OWNER_FORK_NAME,
      firstMessage: "the owner forked this session",
    });
    const child = await writeParentedSession(harness.home, {
      parentSessionPath: harness.seeded.path,
      name: SUBAGENT_CHILD_NAME,
      firstMessage: "the subagent ran this session",
    });
    await openDrawer(page, harness);

    // A fork is a Session the owner started; only the run's child is dropped.
    await expect(page.getByTestId("session-row")).toHaveCount(2);
    await expect(rowOf(page, fork)).toHaveCount(1);
    await expect(rowOf(page, harness.seeded)).toHaveCount(1);
    await expect(rowOf(page, child)).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

// Wiring claim: one of a child's two facts is not enough to hide a Session from the drawer.
test("a Session with only one of a child's facts stays listed", async ({ page }) => {
  const harness = await startHarness();
  try {
    // The run-id name shape alone: pi reported no parent path for this file.
    const runIdNamed = await writeParentedSession(harness.home, {
      name: SUBAGENT_CHILD_NAME,
      firstMessage: "the owner gave this session a run-id-shaped name",
    });
    // A parent pointer alone, which is what pi writes for a fork whose name it never filled in.
    const parentLinked = await writeParentedSession(harness.home, {
      parentSessionPath: harness.seeded.path,
      name: OWNER_FORK_NAME,
      firstMessage: "the owner forked this session",
    });
    await openDrawer(page, harness);

    await expect(page.getByTestId("session-row")).toHaveCount(3);
    await expect(rowOf(page, runIdNamed)).toHaveCount(1);
    await expect(rowOf(page, parentLinked)).toHaveCount(1);
    await expect(rowOf(page, harness.seeded)).toHaveCount(1);
  } finally {
    await disposeHarness(harness);
  }
});

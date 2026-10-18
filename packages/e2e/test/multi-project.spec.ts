import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";

const PI_TEST_TIMEOUT_MS = 120_000;
const PI_START_TIMEOUT_MS = 30_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** The marker each seeded Session carries on its own active path. */
const FIRST_MARKER = "Seed text block 54.";
const SECOND_MARKER = "Seed text block 32.";

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

const REPLY_SCRIPT: Script = [
  {
    expect: { role: "user", text: "hello there" },
    reply: {
      content: [{ type: "text", text: "reply from the chosen Project" }],
      stopReason: "stop",
    },
  },
];

/** A run that stays live on a bash tool, so leaving its Project happens while it works. */
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

interface Harness {
  readonly home: HermeticHome;
  readonly first: string;
  readonly second: string;
  readonly firstSession: FixtureSession;
  readonly secondSession: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script = UNUSED_SCRIPT): Promise<Harness> {
  const home = await createHermeticHome();
  const secondDirectory = join(home.root, "second-project");
  await mkdir(secondDirectory, { recursive: true });
  const first = await realpath(home.workspace);
  const second = await realpath(secondDirectory);
  const firstSession = await seedSession(home, "plain");
  const secondSession = await seedSession(home, "branching", { project: second });
  const launch = await scriptedPiLaunch(home, script);
  const server = await startServer({
    projects: [first, second],
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
  return { home, first, second, firstSession, secondSession, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

function projectUrl(harness: Harness, project: string, sessionId?: string): string {
  const params = new URLSearchParams({ project, ws: harness.server.url });
  if (sessionId !== undefined) {
    params.set("session", sessionId);
  }
  return `${harness.client.url}?${params.toString()}`;
}

async function openProject(page: Page, harness: Harness, project: string): Promise<void> {
  await page.goto(projectUrl(harness, project));
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

async function openDrawer(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Toggle sessions sidebar" });
  if ((await page.getByTestId("session-drawer").count()) === 0) {
    await toggle.click();
  }
  await expect(page.getByTestId("session-drawer")).toBeVisible();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("the drawer lists only the chosen Project's Sessions", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openProject(page, harness, harness.first);
    await openDrawer(page);

    await expect(page.getByTestId("session-row")).toHaveCount(1);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.firstSession.id,
    );
    await expect(page.getByTestId("session-row")).not.toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );

    await openProject(page, harness, harness.second);
    await openDrawer(page);

    await expect(page.getByTestId("session-row")).toHaveCount(1);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );
    await expect(page.getByTestId("session-row")).not.toHaveAttribute(
      "data-session-id",
      harness.firstSession.id,
    );
  } finally {
    await disposeHarness(harness);
  }
});

test("a Session opens and answers a prompt inside its own Project", async ({ page }) => {
  const harness = await startHarness(REPLY_SCRIPT);
  try {
    await page.goto(projectUrl(harness, harness.second, harness.secondSession.id));
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText(SECOND_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).not.toContainText(FIRST_MARKER);

    await sendMessage(page, "hello there");
    await expect(page.getByTestId("transcript")).toContainText("reply from the chosen Project", {
      timeout: PI_START_TIMEOUT_MS,
    });
  } finally {
    await disposeHarness(harness);
  }
});

test("creating a Session starts it in the chosen Project", async ({ page }) => {
  const harness = await startHarness(REPLY_SCRIPT);
  try {
    await openProject(page, harness, harness.second);
    await openDrawer(page);
    await page.getByTestId("new-session-action").click();

    const shell = page.getByTestId("app-shell");
    await expect(shell).not.toHaveAttribute("data-session-id", harness.secondSession.id);
    // The id arrives in the server's answer, so it is waited for rather than read from the click.
    await expect(shell).toHaveAttribute(
      "data-session-id",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const created = await shell.getAttribute("data-session-id");
    expect(created).not.toBeNull();

    // pi writes a fresh Session's file when it first persists a turn, so the prompt is also what
    // makes the new Session discoverable in its Project's list.
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();
    await sendMessage(page, "hello there");
    await expect(page.getByTestId("transcript")).toContainText("reply from the chosen Project", {
      timeout: PI_START_TIMEOUT_MS,
    });

    const secondClient = await connectWsSession(harness.server.url);
    try {
      await expect
        .poll(
          async () => {
            secondClient.send({ type: "listSessions", project: harness.second });
            const listed = await secondClient.next();
            return listed.type === "sessions" ? listed.sessions.map((session) => session.id) : [];
          },
          { timeout: PI_START_TIMEOUT_MS },
        )
        .toContain(created);
    } finally {
      await secondClient.close();
    }
    await openDrawer(page);
    await expect(page.getByTestId("session-row")).toHaveCount(2, { timeout: PI_START_TIMEOUT_MS });

    const firstClient = await connectWsSession(harness.server.url);
    try {
      firstClient.send({ type: "listSessions", project: harness.first });
      const listed = await firstClient.next();
      expect(listed.type).toBe("sessions");
      if (listed.type !== "sessions") {
        return;
      }
      expect(listed.project).toBe(harness.first);
      expect(listed.sessions.map((session) => session.id)).not.toContain(created);
    } finally {
      await firstClient.close();
    }
  } finally {
    await disposeHarness(harness);
  }
});

test("a run keeps working while another Project is viewed", async ({ page }) => {
  const harness = await startHarness(BACKGROUND_SCRIPT);
  try {
    await page.goto(projectUrl(harness, harness.first, harness.firstSession.id));
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await sendMessage(page, "run the slow background command");
    await expect(page.getByTestId("transcript")).toContainText("starting the background run");

    // The other Project is a different page load, which is the strongest form of leaving: the socket
    // the run first reached is gone, and the child must still finish on the server.
    await openProject(page, harness, harness.second);
    await openDrawer(page);
    await expect(page.getByTestId("session-row")).toHaveCount(1);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );
    await expect(page.getByTestId("transcript")).not.toContainText("starting the background run");

    await page.goto(projectUrl(harness, harness.first, harness.firstSession.id));
    await expect(page.getByTestId("transcript")).toContainText("background run finished", {
      timeout: PI_START_TIMEOUT_MS,
    });
  } finally {
    await disposeHarness(harness);
  }
});

test("a connection watching one Project is pushed no other Project's list", async () => {
  const harness = await startHarness();
  const firstViewer = await connectWsSession(harness.server.url);
  const secondViewer = await connectWsSession(harness.server.url);
  try {
    firstViewer.send({ type: "listSessions", project: harness.first });
    expect(await firstViewer.next()).toMatchObject({ type: "sessions", project: harness.first });

    secondViewer.send({ type: "listSessions", project: harness.second });
    expect(await secondViewer.next()).toMatchObject({ type: "sessions", project: harness.second });

    // A fresh Session pushes the list of the Project it was created in. The two connections watch
    // different Projects, so only the one that asked for the second may hear about it.
    secondViewer.send({ type: "createSession", project: harness.second });
    expect(await secondViewer.next()).toMatchObject({
      type: "sessionCreated",
      session: { project: harness.second },
    });
    expect(await secondViewer.next()).toMatchObject({
      type: "sessions",
      project: harness.second,
    });

    // The server writes that push before it answers anything else this connection sends, so a list
    // for the second Project would arrive ahead of this answer if the push had been widened.
    firstViewer.send({ type: "listSessions", project: harness.first });
    const afterPush = await firstViewer.next();
    expect(afterPush).toMatchObject({ type: "sessions", project: harness.first });
    if (afterPush.type !== "sessions") {
      return;
    }
    expect(afterPush.sessions.map((session) => session.id)).toEqual([harness.firstSession.id]);
  } finally {
    await firstViewer.close();
    await secondViewer.close();
    await disposeHarness(harness);
  }
});

test("a pair naming an id from another Project is refused and nothing is searched", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({
      type: "subscribe",
      session: { project: harness.second, id: harness.firstSession.id },
    });
    const refused = await client.next();
    expect(refused).toMatchObject({
      type: "error",
      error: { code: "unknownSession" },
      session: { project: harness.second, id: harness.firstSession.id },
    });

    // The refused id was not looked for anywhere: the second Project's own list is unchanged, and
    // the first Project still holds the Session the pair named.
    client.send({ type: "listSessions", project: harness.second });
    const secondList = await client.next();
    expect(secondList.type).toBe("sessions");
    if (secondList.type !== "sessions") {
      return;
    }
    expect(secondList.sessions.map((session) => session.id)).toEqual([harness.secondSession.id]);

    client.send({ type: "listSessions", project: harness.first });
    const firstList = await client.next();
    expect(firstList.type).toBe("sessions");
    if (firstList.type !== "sessions") {
      return;
    }
    expect(firstList.sessions.map((session) => session.id)).toEqual([harness.firstSession.id]);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import {
  disposeHarness,
  FIRST_MARKER,
  type Harness,
  MULTI_PROJECT_START_TIMEOUT_MS as PI_START_TIMEOUT_MS,
  nextOf,
  openDrawer,
  openProject,
  openSession,
  projectRow,
  projectUrl,
  REPLY_SCRIPT,
  SECOND_MARKER,
  sendMessage,
  startHarness,
  switchProject,
} from "../src/multi-project-harness";
import { connectWsSession } from "../src/ws-session-client";

/**
 * How long a returning reader waits for the background run's outcome. It bounds the wait on the
 * script's own ten-second hold, not the whole test, so it is shorter than the per-test budget.
 */
const BACKGROUND_RUN_OUTCOME_TIMEOUT_MS = 20_000;

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

/**
 * Start a run in the first Project, leave for the other, and come back to the run still finishing.
 * `leave` and `returnToFirst` choose how the reader travels; everything a run must survive is the
 * same either way, so the body is written once.
 */
async function runSurvivesLeaving(
  page: Page,
  harness: Harness,
  leave: () => Promise<void>,
  returnToFirst: () => Promise<void>,
): Promise<void> {
  await page.goto(projectUrl(harness, harness.first, harness.firstSession.id));
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
    timeout: PI_START_TIMEOUT_MS,
  });
  await sendMessage(page, "run the slow background command");
  await expect(page.getByTestId("transcript")).toContainText("starting the background run");

  await leave();
  await expect(page.getByTestId("session-row")).toHaveCount(1);
  await expect(page.getByTestId("session-row")).toHaveAttribute(
    "data-session-id",
    harness.secondSession.id,
  );
  await expect(page.getByTestId("transcript")).not.toContainText("starting the background run");

  await returnToFirst();
  await expect(page.getByTestId("transcript")).toContainText("background run finished", {
    timeout: BACKGROUND_RUN_OUTCOME_TIMEOUT_MS,
  });
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
    await runSurvivesLeaving(
      page,
      harness,
      async () => {
        // The other Project is a different page load, which is the strongest form of leaving: the
        // socket the run first reached is gone, and the child must still finish on the server.
        await openProject(page, harness, harness.second);
        await openDrawer(page);
      },
      async () => {
        await page.goto(projectUrl(harness, harness.first, harness.firstSession.id));
      },
    );
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

test("a refused pair leaves the Session the connection was watching attached", async () => {
  const harness = await startHarness(REPLY_SCRIPT);
  const watcher = await connectWsSession(harness.server.url);
  const runner = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    watcher.send({ type: "subscribe", session });
    expect((await nextOf(watcher, "snapshot")).session).toEqual(session);

    // The pair names an id the second Project does not hold, so the server refuses it.
    watcher.send({ type: "subscribe", session: { project: harness.second, id: session.id } });
    expect(await nextOf(watcher, "error")).toMatchObject({
      type: "error",
      error: { code: "unknownSession" },
      session: { project: harness.second, id: session.id },
    });

    // The run reaches the Session the connection was legitimately watching, so the refusal did not
    // detach the attach that refused pair never replaced.
    runner.send({ type: "prompt", session, text: "hello there" });
    expect((await nextOf(watcher, "delta")).session).toEqual(session);
  } finally {
    await watcher.close();
    await runner.close();
    await disposeHarness(harness);
  }
});

test("renaming in one Project refreshes only that Project's list", async () => {
  const harness = await startHarness();
  const firstViewer = await connectWsSession(harness.server.url);
  const secondViewer = await connectWsSession(harness.server.url);
  try {
    firstViewer.send({ type: "listSessions", project: harness.first });
    expect((await nextOf(firstViewer, "sessions")).project).toBe(harness.first);
    secondViewer.send({ type: "listSessions", project: harness.second });
    expect((await nextOf(secondViewer, "sessions")).project).toBe(harness.second);

    const renamed = "Renamed inside the second Project";
    secondViewer.send({
      type: "setSessionName",
      session: { project: harness.second, id: harness.secondSession.id },
      name: renamed,
    });
    expect((await nextOf(secondViewer, "sessionRenamed")).session).toEqual({
      project: harness.second,
      id: harness.secondSession.id,
    });
    const pushed = await nextOf(secondViewer, "sessions");
    expect(pushed.project).toBe(harness.second);
    expect(pushed.sessions.find((session) => session.id === harness.secondSession.id)?.name).toBe(
      renamed,
    );

    // A list push for the second Project would arrive before this answer if it had been sent to the
    // connection watching the first Project.
    firstViewer.send({ type: "listSessions", project: harness.first });
    const firstList = await nextOf(firstViewer, "sessions");
    expect(firstList.project).toBe(harness.first);
    expect(firstList.sessions.map((session) => session.id)).toEqual([harness.firstSession.id]);
    expect(firstList.sessions.some((session) => session.name === renamed)).toBe(false);
  } finally {
    await firstViewer.close();
    await secondViewer.close();
    await disposeHarness(harness);
  }
});

test("the drawer's Sessions and the file panel change together on one switch", async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(projectUrl(harness, harness.first, harness.firstSession.id));
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    // The panel names the chosen Project and holds only that Project's rows.
    await page.getByTestId("files-toggle").click();
    await expect(page.getByTestId("file-tree-root")).toHaveText(harness.first);
    await expect(
      page.getByTestId("file-tree-file").filter({ hasText: "first-only.txt" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("file-tree-file").filter({ hasText: "second-only.txt" }),
    ).toHaveCount(0);
    await page.getByTestId("file-tree-close").click();
    await expect(page.getByTestId("file-tree")).toHaveCount(0);

    // One switch, taken from the drawer, moves the Session rows to the other Project.
    await openDrawer(page);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.firstSession.id,
    );
    await page.getByTestId("project-switch").click();
    await projectRow(page, harness.second).click();
    await expect(page.getByTestId("session-drawer")).toHaveAttribute("data-level", "sessions");
    await expect(page.getByTestId("session-row")).toHaveCount(1);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );
    await expect(page.getByTestId("session-row")).not.toHaveAttribute(
      "data-session-id",
      harness.firstSession.id,
    );
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();

    // The panel named the first Project, so that switch closed it rather than leaving it to draw
    // another root's rows. Reopening asks for the Project now chosen.
    await expect(page.getByTestId("file-tree")).toHaveCount(0);
    await page.getByTestId("files-toggle").click();
    await expect(page.getByTestId("file-tree-root")).toHaveText(harness.second);
    await expect(
      page.getByTestId("file-tree-file").filter({ hasText: "second-only.txt" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("file-tree-file").filter({ hasText: "first-only.txt" }),
    ).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

test("a run keeps working while another Project is viewed without reloading", async ({ page }) => {
  const harness = await startHarness(BACKGROUND_SCRIPT);
  try {
    await runSurvivesLeaving(
      page,
      harness,
      async () => {
        await switchProject(page, harness.second);
      },
      async () => {
        await switchProject(page, harness.first);
        await openSession(page, harness.firstSession.id);
      },
    );
  } finally {
    await disposeHarness(harness);
  }
});

test("a Session from the Project left behind still opens after switching away", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await page.goto(projectUrl(harness, harness.first, harness.firstSession.id));
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await switchProject(page, harness.second);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );

    await switchProject(page, harness.first);
    await openSession(page, harness.firstSession.id);
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).not.toContainText(SECOND_MARKER);
  } finally {
    await disposeHarness(harness);
  }
});

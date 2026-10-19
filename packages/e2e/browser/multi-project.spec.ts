import { expect, test, type Page } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import type { Gate } from "../src/gate";
import {
  disposeHarness,
  FIRST_MARKER,
  type Harness,
  MULTI_PROJECT_START_TIMEOUT_MS as PI_START_TIMEOUT_MS,
  openDrawer,
  openProject,
  openSession,
  projectUrl,
  REPLY_SCRIPT,
  SECOND_MARKER,
  sendMessage,
  startHarness,
  switchProject,
} from "../src/multi-project-harness";
import { connectWsSession } from "../src/ws-session-client";

/**
 * How long a returning reader waits for the background run's outcome. The gate frees the command as
 * soon as the test has seen the run is live, so this bound covers rendering the reply rather than
 * the run's own hold, and it stays inside the suite's forty-five second test budget.
 */
const BACKGROUND_RUN_OUTCOME_TIMEOUT_MS = 20_000;

/**
 * A run that stays live on a bash tool until the test opens its gate, so leaving its Project
 * happens while it genuinely works, however long the reader takes to come back.
 */
function backgroundScript(gate: (name: string) => Gate): Script {
  return [
    {
      expect: { role: "user", text: "run the slow background command" },
      reply: {
        content: [
          { type: "text", text: "starting the background run" },
          {
            type: "toolCall",
            id: "call_background_1",
            name: "bash",
            arguments: { ...gate("build").command("echo built") },
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
}

/**
 * Start a run in the first Project, leave for the other, and come back to the run still finishing.
 * `leave` and `returnToFirst` choose how the reader travels; everything a run must survive is the
 * same either way, so the body is written once.
 */
async function runSurvivesLeaving(
  page: Page,
  harness: Harness,
  build: Gate,
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

  // The first run is blocked on this gate, so its outcome cannot arrive while the reader is away.
  // Observing the other Project's list and the missing outcome before opening the gate is what
  // makes the return a continuation rather than a re-read of a run that happened to still be there.
  await build.releaseAfter(async () => {
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );
    await expect(page.getByTestId("transcript")).not.toContainText("background run finished");
  });

  await returnToFirst();
  await expect(page.getByTestId("transcript")).toContainText("background run finished", {
    timeout: BACKGROUND_RUN_OUTCOME_TIMEOUT_MS,
  });
}

// Wiring claim: a Session's Pi child runs in the Session's own Project and answers from that Project's file.
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

// Wiring claim: a created Session's Pi child writes into the chosen Project and only that Project lists it.
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

// Wiring claim: a run in one Project survives a full reload into another Project.
test("a run keeps working while another Project is viewed", async ({ page }) => {
  const harness = await startHarness(backgroundScript);
  const build = harness.gate("build");
  try {
    await runSurvivesLeaving(
      page,
      harness,
      build,
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

// Wiring claim: a run in one Project survives an in-app switch to another Project and back.
test("a run keeps working while another Project is viewed without reloading", async ({ page }) => {
  const harness = await startHarness(backgroundScript);
  const build = harness.gate("build");
  try {
    await runSurvivesLeaving(
      page,
      harness,
      build,
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

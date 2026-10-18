import { access, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { ServerMessage, TreeNode } from "@pi-my-ui/protocol";
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
/** What the delegated agent says before it starts the command the steer interrupts. */
const AGENT_TEXT = "watching the build now";
const STEER_TEXT = "tighten the loop";
const STEERED_REPLY = "the agent tightened the loop";

/** A delegated run that stays live long enough for the steer to arrive while it works. */
const STEERING_SCRIPT: Script = [
  {
    expect: { role: "user", text: "delegate the build" },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_agent_1",
          name: "Agent",
          arguments: {
            subagent_type: "general-purpose",
            prompt: "watch the build",
            description: "Watch the build",
            run_in_background: false,
          },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "user", text: "watch the build" },
    reply: {
      content: [
        { type: "text", text: AGENT_TEXT },
        {
          type: "toolCall",
          id: "call_subagent_bash_1",
          name: "bash",
          arguments: { command: "sleep 12 && echo built", timeout: 60 },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "user", text: STEER_TEXT },
    reply: { content: [{ type: "text", text: STEERED_REPLY }], stopReason: "stop" },
  },
  {
    expect: { role: "toolResult", toolName: "Agent" },
    reply: { content: [{ type: "text", text: "the parent finished" }], stopReason: "stop" },
  },
];

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

/** The next frame of one type; the server also pushes lists and attach surfaces on its own. */
async function nextOf<T extends ServerMessage["type"]>(
  client: Awaited<ReturnType<typeof connectWsSession>>,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  for (;;) {
    const message = await client.next();
    if (message.type === type) {
      return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

/** Every node of a message tree, depth first. */
function flattenTree(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** The opened Session's id, once the shell has switched away from the one it started on. */
async function openedSessionId(page: Page, previousId: string): Promise<string> {
  const shell = page.getByTestId("app-shell");
  await expect(shell).not.toHaveAttribute("data-session-id", previousId);
  const opened = await shell.getAttribute("data-session-id");
  if (opened === null || opened === "") {
    throw new Error("the shell opened no Session");
  }
  return opened;
}

/** Open the agent list from the pill and focus the Session's only agent. */
async function focusAgent(page: Page): Promise<void> {
  await expect(page.getByTestId("agent-pill")).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  await page.getByTestId("agent-pill").click();
  await page.locator('[data-testid="agent-row"][data-row-kind="agent"]').first().click();
  await expect(page.getByTestId("agent-list")).toHaveCount(0);
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

test("a bare sessionId is refused for every Session command", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const bare = (fields: Readonly<Record<string, unknown>>) => ({
      ...fields,
      sessionId: harness.secondSession.id,
    });
    const commands = [
      bare({ type: "bash", command: "echo hi", excludeFromContext: false }),
      bare({ type: "setModel", provider: "scripted", modelId: "scripted" }),
      bare({ type: "setThinkingLevel", level: "low" }),
      bare({ type: "setAutoCompaction", enabled: true }),
      bare({ type: "compact" }),
      bare({ type: "getSessionStats" }),
      bare({ type: "setSessionName", name: "a name" }),
      bare({ type: "exportSession" }),
      bare({ type: "getForkMessages" }),
      bare({ type: "forkSession", entryId: harness.secondSession.leafId ?? "entry" }),
      bare({ type: "cloneSession" }),
      bare({ type: "getTree" }),
      bare({ type: "moveLeaf", entryId: harness.secondSession.leafId ?? "entry" }),
      bare({ type: "reconnect" }),
      bare({ type: "steerSubagent", agentId: "agent-1", message: "go on" }),
      bare({ type: "getSubagentTranscript", agentId: "agent-1" }),
    ];

    for (const command of commands) {
      client.send(command);
      expect(await client.next()).toMatchObject({
        type: "error",
        error: { code: "malformedPayload" },
      });
    }
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("fork and clone open their new Session in the source Project", async ({ page }) => {
  const harness = await startHarness();
  const otherClient = await connectWsSession(harness.server.url);
  try {
    await page.goto(projectUrl(harness, harness.second, harness.secondSession.id));
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText(SECOND_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await sendMessage(page, "/clone");
    await expect(page.getByTestId("command-notice")).toHaveText(
      "Clone created a new session, now open.",
    );
    const clonedId = await openedSessionId(page, harness.secondSession.id);
    expect(clonedId).not.toBe(harness.secondSession.id);

    await openDrawer(page);
    await expect(page.getByTestId("session-row")).toHaveCount(2);
    await expect(
      page.locator(`[data-testid="session-row"][data-session-id="${clonedId}"]`),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();

    await sendMessage(page, "/fork");
    const picker = page.getByTestId("fork-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId("fork-picker-row").last()).toBeVisible();
    await picker.getByTestId("fork-picker-row").last().click();
    await expect(page.getByTestId("command-notice")).toHaveText(
      "Fork created a new session, now open.",
    );
    const forkedId = await openedSessionId(page, clonedId);
    expect(forkedId).not.toBe(clonedId);
    expect(forkedId).not.toBe(harness.secondSession.id);

    otherClient.send({ type: "listSessions", project: harness.second });
    const secondList = await nextOf(otherClient, "sessions");
    expect(secondList.project).toBe(harness.second);
    expect(secondList.sessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([harness.secondSession.id, clonedId, forkedId]),
    );

    otherClient.send({ type: "listSessions", project: harness.first });
    const firstList = await nextOf(otherClient, "sessions");
    expect(firstList.project).toBe(harness.first);
    const firstIds = firstList.sessions.map((session) => session.id);
    expect(firstIds).not.toContain(clonedId);
    expect(firstIds).not.toContain(forkedId);
  } finally {
    await otherClient.close();
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

test("exporting a Session writes inside its own Project", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({
      type: "subscribe",
      session: { project: harness.second, id: harness.secondSession.id },
    });
    expect((await nextOf(client, "snapshot")).session).toEqual({
      project: harness.second,
      id: harness.secondSession.id,
    });

    client.send({
      type: "exportSession",
      session: { project: harness.second, id: harness.secondSession.id },
    });
    const exported = await nextOf(client, "sessionExported");
    expect(exported.session).toEqual({
      project: harness.second,
      id: harness.secondSession.id,
    });

    const written = resolve(harness.second, exported.path);
    const fromSecond = relative(harness.second, written);
    expect(isAbsolute(fromSecond) || fromSecond.startsWith("..")).toBe(false);
    expect(await readFile(written, "utf8")).toContain("<html");

    const fromFirst = relative(harness.first, written);
    expect(isAbsolute(fromFirst) || fromFirst.startsWith("..")).toBe(true);
    await expect(access(resolve(harness.first, exported.path))).rejects.toThrow();
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("the tree and a Leaf move run through a Project's own pair", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.second, id: harness.secondSession.id };
    client.send({ type: "subscribe", session });
    expect((await nextOf(client, "snapshot")).session).toEqual(session);

    client.send({ type: "getTree", session });
    const tree = await nextOf(client, "sessionTree");
    expect(tree.session).toEqual(session);
    expect(tree.tree.leafId).toBe(harness.secondSession.leafId);

    const userNode = flattenTree(tree.tree.roots).find((node) => node.entry.role === "user");
    expect(userNode).toBeDefined();
    if (userNode === undefined) {
      return;
    }

    client.send({ type: "moveLeaf", session, entryId: userNode.entry.id });
    const moved = await nextOf(client, "leafMoved");
    expect(moved.session).toEqual(session);
    expect(moved.entryId).toBe(userNode.entry.id);
    expect(moved.leafId).toBe(userNode.entry.parentId);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("reconnect respawns a Session through its Project's pair", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.second, id: harness.secondSession.id };
    client.send({ type: "subscribe", session });
    expect((await nextOf(client, "snapshot")).session).toEqual(session);

    client.send({ type: "reconnect", session });
    const respawned = await nextOf(client, "snapshot");
    expect(respawned.session).toEqual(session);
    expect(respawned.projection.leafId).toBe(harness.secondSession.leafId);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("a settled subagent's transcript is read through its Project's pair", async () => {
  const harness = await startHarness();
  const agentSession = await seedSession(harness.home, "subagents", {
    project: harness.second,
    id: "01a10000-0000-7000-8000-0000000000b3",
    timestamp: "2025-01-02T00:00:00.000Z",
  });
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.second, id: agentSession.id };
    client.send({ type: "subscribe", session });
    const snapshot = await nextOf(client, "snapshot");
    expect(snapshot.session).toEqual(session);
    const agent = snapshot.projection.subagents[0];
    expect(agent).toBeDefined();
    if (agent === undefined) {
      return;
    }

    client.send({ type: "getSubagentTranscript", session, agentId: agent.id });
    const transcript = await nextOf(client, "subagentTranscript");
    expect(transcript.session).toEqual(session);
    expect(transcript.agentId).toBe(agent.id);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("a steer reaches a running agent in another Project", async ({ page }) => {
  const harness = await startHarness(STEERING_SCRIPT);
  // The branching seed already holds a settled agent; a plain Session keeps the focus on the one
  // this run starts.
  const steeringSession = await seedSession(harness.home, "plain", {
    project: harness.second,
    id: "01a10000-0000-7000-8000-0000000000b4",
    timestamp: "2025-01-02T00:00:01.000Z",
  });
  try {
    await page.goto(projectUrl(harness, harness.second, steeringSession.id));
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await sendMessage(page, "delegate the build");
    await focusAgent(page);

    const transcript = page.getByTestId("transcript");
    await expect(transcript).toContainText(AGENT_TEXT);

    await page.getByTestId("composer-input").fill(STEER_TEXT);
    await page.getByTestId("composer-send-while-running").click();
    await expect(transcript).toContainText(STEERED_REPLY, { timeout: 60_000 });
  } finally {
    await disposeHarness(harness);
  }
});

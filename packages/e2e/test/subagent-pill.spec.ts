import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

/**
 * The parent asks the real `Agent` tool for a subagent, and the subagent spends long enough on a
 * shell command for the browser to observe it working. Both model calls are the scripted provider's,
 * so the run is deterministic without standing in for pi or for pi-subagents.
 */
const SPAWN_SCRIPT: Script = [
  {
    expect: { role: "user", text: "spawn a helper" },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_agent_1",
          name: "Agent",
          arguments: {
            subagent_type: "general-purpose",
            prompt: "say hi slowly",
            description: "Say hi slowly",
            run_in_background: false,
          },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "user", text: "say hi slowly" },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_subagent_bash_1",
          name: "bash",
          arguments: { command: "sleep 5 && echo subagent-ran", timeout: 30 },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "bash" },
    reply: { content: [{ type: "text", text: "the subagent finished" }], stopReason: "stop" },
  },
  {
    expect: { role: "toolResult", toolName: "Agent" },
    reply: { content: [{ type: "text", text: "the parent finished" }], stopReason: "stop" },
  },
];

/**
 * A background spawn: the parent settles while the subagent is still holding a shell command open, so
 * the count on `main` is the only thing showing that work continues behind the main view.
 */
const BACKGROUND_SCRIPT: Script = [
  {
    expect: { role: "user", text: "spawn a helper in the background" },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_agent_bg",
          name: "Agent",
          arguments: {
            subagent_type: "general-purpose",
            prompt: "say hi slowly",
            description: "Say hi slowly",
            run_in_background: true,
          },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "Agent" },
    reply: {
      content: [{ type: "text", text: "the background helper is running" }],
      stopReason: "stop",
    },
  },
  {
    expect: { role: "user", text: "say hi slowly" },
    reply: {
      content: [
        {
          type: "toolCall",
          id: "call_subagent_bg_bash",
          name: "bash",
          arguments: { command: "sleep 5 && echo subagent-ran", timeout: 30 },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "bash" },
    reply: { content: [{ type: "text", text: "the subagent finished" }], stopReason: "stop" },
  },
];

const PLAIN_SCRIPT: Script = [
  {
    expect: { role: "user", text: "hello there" },
    reply: { content: [{ type: "text", text: "a plain reply" }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(
  script: Script,
  options: { readonly piSubagents: boolean },
): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, script, { piSubagents: options.piSubagents });
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
  await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("a scripted Agent call spawns a real subagent and the pill counts it", async ({ page }) => {
  const harness = await startHarness(SPAWN_SCRIPT, { piSubagents: true });
  try {
    await openHarness(page, harness);
    await expect(page.getByTestId("agent-pill")).toHaveCount(0);
    // pi-subagents registers its own `/agents` command, so its presence in the palette proves the
    // extension is loaded and the absence test below is about the extension, not about a spawn.
    await page.getByTestId("composer-input").fill("/agents");
    await expect(page.locator('[data-entry-key$=":agents"]')).toBeVisible();
    await page.getByTestId("composer-input").fill("");

    await sendMessage(page, "spawn a helper");

    // The subagent is on its shell command, so main reports one other agent working.
    const pill = page.getByTestId("agent-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("data-pill-kind", "main");
    await expect(page.getByTestId("agent-pill-label")).toHaveText("main +1");

    // Once the run settles the count is gone; the pill still says where the view is.
    await expect(page.getByTestId("transcript")).toContainText("the parent finished", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("agent-pill-label")).toHaveText("main");
  } finally {
    await disposeHarness(harness);
  }
});

test("a background subagent is counted on main after the parent settles", async ({ page }) => {
  const harness = await startHarness(BACKGROUND_SCRIPT, { piSubagents: true });
  try {
    await openHarness(page, harness);
    await sendMessage(page, "spawn a helper in the background");

    // The parent's own turn is over, yet the pill keeps the background agent counted.
    await expect(page.getByTestId("transcript")).toContainText("the background helper is running", {
      timeout: 30_000,
    });
    const pill = page.getByTestId("agent-pill");
    await expect(pill).toHaveAttribute("data-pill-kind", "main");
    await expect(page.getByTestId("agent-pill-label")).toHaveText("main +1");

    await expect(page.getByTestId("transcript")).toContainText("the subagent finished", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("agent-pill-label")).toHaveText("main");
  } finally {
    await disposeHarness(harness);
  }
});

test("without pi-subagents the extension is absent and no agent pill is shown", async ({
  page,
}) => {
  const harness = await startHarness(PLAIN_SCRIPT, { piSubagents: false });
  try {
    await openHarness(page, harness);

    // pi reports the commands its loaded extensions registered. With pi-subagents not loaded its
    // `/agents` command is missing, which is evidence about the child's extensions rather than an
    // absence of agents that a plain prompt would produce anyway.
    await page.getByTestId("composer-input").fill("/agents");
    await expect(page.locator('[data-entry-key$=":agents"]')).toHaveCount(0);
    await page.getByTestId("composer-input").fill("");

    await sendMessage(page, "hello there");
    await expect(page.getByTestId("transcript")).toContainText("a plain reply");
    // The Session itself still renders normally; only the subagent surface is absent.
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("agent-pill")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

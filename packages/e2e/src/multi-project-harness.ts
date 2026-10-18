/**
 * One two-Project server, its client page server and the browser steps a multi-Project spec shares.
 * Both multi-Project specs drive the same served list, so the harness lives here rather than in one
 * of them: a copy would drift the moment one spec learns a new step.
 */

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { ServerMessage } from "@pi-my-ui/protocol";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "./client-page-server";
import { seedSession, type FixtureSession } from "./fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "./pi-harness";
import type { WsSessionClient } from "./ws-session-client";

/** The marker each seeded Session carries on its own active path. */
export const FIRST_MARKER = "Seed text block 54.";
export const SECOND_MARKER = "Seed text block 32.";

/**
 * A multi-Project case starts pi and a browser, so it is slower than a default case. Both specs
 * read the budget from here rather than carrying a copy that could drift from the other's.
 */
export const MULTI_PROJECT_TEST_TIMEOUT_MS = 120_000;
export const MULTI_PROJECT_START_TIMEOUT_MS = 30_000;

export const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

export const REPLY_SCRIPT: Script = [
  {
    expect: { role: "user", text: "hello there" },
    reply: {
      content: [{ type: "text", text: "reply from the chosen Project" }],
      stopReason: "stop",
    },
  },
];

/** What every harness owns, whatever Projects it serves. */
export interface ServedHarness {
  readonly home: HermeticHome;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

export interface Harness extends ServedHarness {
  readonly first: string;
  readonly second: string;
  readonly empty: string;
  readonly firstSession: FixtureSession;
  readonly secondSession: FixtureSession;
}

export interface SingleHarness extends ServedHarness {
  readonly project: string;
  readonly session: FixtureSession;
}

/**
 * Two Projects that share a last path segment, reachable only as `work/api` and `oss/api`. Nothing
 * is seeded: a label is the served list's fact, so this harness exists to show the choice.
 */
export interface SharedNameHarness extends ServedHarness {
  readonly first: string;
  readonly second: string;
}

/** Start one server over `projects` and its client page server. */
async function serve(
  home: HermeticHome,
  projects: readonly string[],
  script: Script,
): Promise<{ server: RunningServer; client: ClientPageServer }> {
  const launch = await scriptedPiLaunch(home, script);
  const server = await startServer({
    projects,
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
  return { server, client };
}

async function startHarness(script: Script = UNUSED_SCRIPT): Promise<Harness> {
  const home = await createHermeticHome();
  const secondDirectory = join(home.root, "second-project");
  const emptyDirectory = join(home.root, "empty-project");
  await mkdir(secondDirectory, { recursive: true });
  await mkdir(emptyDirectory, { recursive: true });
  const first = await realpath(home.workspace);
  const second = await realpath(secondDirectory);
  const empty = await realpath(emptyDirectory);
  // A file only one Project holds, so a panel rooted at the wrong Project is visible as a wrong row.
  await writeFile(join(first, "first-only.txt"), "first project file\n", "utf8");
  await writeFile(join(second, "second-only.txt"), "second project file\n", "utf8");
  const firstSession = await seedSession(home, "plain");
  const secondSession = await seedSession(home, "branching", { project: second });
  const { server, client } = await serve(home, [first, second, empty], script);
  return { home, first, second, empty, firstSession, secondSession, server, client };
}

async function startSingleProjectHarness(): Promise<SingleHarness> {
  const home = await createHermeticHome();
  const project = await realpath(home.workspace);
  const session = await seedSession(home, "plain");
  const { server, client } = await serve(home, [project], UNUSED_SCRIPT);
  return { home, project, session, server, client };
}

async function startSharedNameHarness(): Promise<SharedNameHarness> {
  const home = await createHermeticHome();
  const workDirectory = join(home.root, "work", "api");
  const ossDirectory = join(home.root, "oss", "api");
  await mkdir(workDirectory, { recursive: true });
  await mkdir(ossDirectory, { recursive: true });
  const first = await realpath(workDirectory);
  const second = await realpath(ossDirectory);
  const { server, client } = await serve(home, [first, second], UNUSED_SCRIPT);
  return { home, first, second, server, client };
}

/** The next frame of one type; the server also pushes lists and attach surfaces on its own. */
async function nextOf<T extends ServerMessage["type"]>(
  client: WsSessionClient,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  for (;;) {
    const message = await client.next();
    if (message.type === type) {
      return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

async function disposeHarness(harness: ServedHarness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

function projectUrl(harness: ServedHarness, project: string, sessionId?: string): string {
  const params = new URLSearchParams({ project, ws: harness.server.url });
  if (sessionId !== undefined) {
    params.set("session", sessionId);
  }
  return `${harness.client.url}?${params.toString()}`;
}

async function openProject(page: Page, harness: ServedHarness, project: string): Promise<void> {
  await page.goto(projectUrl(harness, project));
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

/** A bare page: no Project linked, so the picker or a remembered Project decides the first screen. */
async function openBarePage(page: Page, harness: ServedHarness): Promise<void> {
  await page.goto(`${harness.client.url}?ws=${encodeURIComponent(harness.server.url)}`);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

/** Seed the device's remembered Project before the page's own scripts run. */
async function rememberProject(page: Page, project: string): Promise<void> {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem("pi-my-ui.project", value);
  }, project);
}

function projectRow(page: Page, project: string) {
  return page.locator(`[data-testid="project-row"][data-project="${project}"]`);
}

async function openDrawer(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Toggle sessions sidebar" });
  if ((await page.getByTestId("session-drawer").count()) === 0) {
    await toggle.click();
  }
  await expect(page.getByTestId("session-drawer")).toBeVisible();
}

/** Open the drawer's Project level and tap one Project, which returns to its Sessions. */
async function switchProject(page: Page, project: string): Promise<void> {
  await openDrawer(page);
  await page.getByTestId("project-switch").click();
  await projectRow(page, project).click();
  await expect(page.getByTestId("session-drawer")).toHaveAttribute("data-level", "sessions");
}

async function openSession(page: Page, sessionId: string): Promise<void> {
  await openDrawer(page);
  await page.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`).click();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

export {
  disposeHarness,
  nextOf,
  openBarePage,
  openDrawer,
  openProject,
  openSession,
  projectRow,
  projectUrl,
  rememberProject,
  sendMessage,
  startHarness,
  startSharedNameHarness,
  startSingleProjectHarness,
  switchProject,
};

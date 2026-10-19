/**
 * One two-Project server, its client page server and the browser steps a multi-Project spec shares.
 * Both multi-Project specs drive the same served list, so the harness lives here rather than in one
 * of them: a copy would drift the moment one spec learns a new step.
 *
 * The server half lives in `multi-project-server-harness.ts`, which imports no browser runner; this
 * module adds the built client page those specs drive.
 */

import { expect, type Page } from "@playwright/test";

import { startClientPageServer, type ClientPageServer } from "./client-page-server";
import {
  disposeHarness as disposeServerHarness,
  FIRST_MARKER,
  MULTI_PROJECT_START_TIMEOUT_MS,
  nextOf,
  REPLY_SCRIPT,
  SECOND_MARKER,
  type Harness as ServerHarness,
  type SharedNameHarness as ServerSharedNameHarness,
  type SingleHarness as ServerSingleHarness,
  type ScriptSource,
  startHarness as startServerHarness,
  startSharedNameHarness as startSharedNameServerHarness,
  startSingleProjectHarness as startSingleProjectServerHarness,
  type ServedHarness as ServerServedHarness,
  UNUSED_SCRIPT,
} from "./multi-project-server-harness";

export { FIRST_MARKER, MULTI_PROJECT_START_TIMEOUT_MS, nextOf, REPLY_SCRIPT, SECOND_MARKER };
export type { ScriptSource };

export interface ServedHarness extends ServerServedHarness {
  readonly client: ClientPageServer;
}

export interface Harness extends ServerHarness {
  readonly client: ClientPageServer;
}

export interface SingleHarness extends ServerSingleHarness {
  readonly client: ClientPageServer;
}

export interface SharedNameHarness extends ServerSharedNameHarness {
  readonly client: ClientPageServer;
}

async function startHarness(script: ScriptSource = UNUSED_SCRIPT): Promise<Harness> {
  const serverHarness = await startServerHarness(script);
  const client = await startClientPageServer();
  return { ...serverHarness, client };
}

async function startSingleProjectHarness(): Promise<SingleHarness> {
  const serverHarness = await startSingleProjectServerHarness();
  const client = await startClientPageServer();
  return { ...serverHarness, client };
}

async function startSharedNameHarness(): Promise<SharedNameHarness> {
  const serverHarness = await startSharedNameServerHarness();
  const client = await startClientPageServer();
  return { ...serverHarness, client };
}

async function disposeHarness(harness: ServedHarness): Promise<void> {
  await harness.client.close();
  await disposeServerHarness(harness);
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

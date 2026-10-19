import { expect, test } from "@playwright/test";

import {
  disposeHarness,
  FIRST_MARKER,
  openBarePage,
  openDrawer,
  openProject,
  projectRow,
  projectUrl,
  rememberProject,
  REPLY_SCRIPT,
  SECOND_MARKER,
  sendMessage,
  startHarness,
  startSharedNameHarness,
  startSingleProjectHarness,
} from "../src/multi-project-harness";

const PI_START_TIMEOUT_MS = 30_000;

test("the first load shows the Project picker and one tap lists that Project's Sessions", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openBarePage(page, harness);

    await expect(page.getByTestId("project-picker")).toBeVisible();
    await expect(page.getByTestId("project-row")).toHaveCount(3);
    await expect(page.getByTestId("files-toggle")).toBeDisabled();

    await projectRow(page, harness.second).click();
    await expect(page.getByTestId("project-picker")).toHaveCount(0);
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("session-row")).toHaveCount(1);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );
    expect(new URL(page.url()).searchParams.get("project")).toBe(harness.second);
  } finally {
    await disposeHarness(harness);
  }
});

test("a remembered Project opens directly and a ?project= link does too", async ({ page }) => {
  const harness = await startHarness();
  try {
    await rememberProject(page, harness.second);
    await openBarePage(page, harness);
    await expect(page.getByTestId("project-picker")).toHaveCount(0);
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.secondSession.id,
    );

    await openProject(page, harness, harness.first);
    await expect(page.getByTestId("project-picker")).toHaveCount(0);
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.firstSession.id,
    );
  } finally {
    await disposeHarness(harness);
  }
});

test("an unserved remembered Project shows the picker with a notice naming the path", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await rememberProject(page, "/workspace/not-served");
    await openBarePage(page, harness);

    await expect(page.getByTestId("project-picker")).toBeVisible();
    await expect(page.getByTestId("project-warning")).toContainText("/workspace/not-served");
    await expect(page.getByTestId("session-row")).toHaveCount(0);
  } finally {
    await disposeHarness(harness);
  }
});

test("an unserved linked Project shows the picker with a notice naming the path", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await page.goto(projectUrl(harness, "/workspace/not-served"));
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    await expect(page.getByTestId("project-picker")).toBeVisible();
    await expect(page.getByTestId("project-warning")).toContainText("/workspace/not-served");
  } finally {
    await disposeHarness(harness);
  }
});

test("a server serving one Project skips the picker", async ({ page }) => {
  const harness = await startSingleProjectHarness();
  try {
    await page.goto(`${harness.client.url}?ws=${encodeURIComponent(harness.server.url)}`);
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    await expect(page.getByTestId("project-picker")).toHaveCount(0);
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.session.id,
    );
    await expect(page.getByTestId("files-toggle")).toBeEnabled();
  } finally {
    await disposeHarness(harness);
  }
});

test("an unserved remembered Project keeps its notice even when one Project is served", async ({
  page,
}) => {
  const harness = await startSingleProjectHarness();
  try {
    await rememberProject(page, "/workspace/not-served");
    await page.goto(`${harness.client.url}?ws=${encodeURIComponent(harness.server.url)}`);
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    await expect(page.getByTestId("project-picker")).toBeVisible();
    await expect(page.getByTestId("project-warning")).toContainText("/workspace/not-served");
    await expect(page.getByTestId("files-toggle")).toBeDisabled();
  } finally {
    await disposeHarness(harness);
  }
});

test("a Project with no Sessions opens to an empty transcript with New Session available", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openBarePage(page, harness);
    await projectRow(page, harness.empty).click();

    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("session-list-empty")).toHaveText("No sessions yet.");
    await expect(page.getByTestId("transcript-empty")).toBeVisible();
    await expect(page.getByTestId("new-session-action")).toBeVisible();

    await page.getByTestId("new-session-action").click();
    await expect(page.getByTestId("app-shell")).toHaveAttribute(
      "data-session-id",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  } finally {
    await disposeHarness(harness);
  }
});

test("two Projects sharing a last path segment are distinguishable in the picker and the drawer", async ({
  page,
}) => {
  const harness = await startSharedNameHarness();
  try {
    await openBarePage(page, harness);
    await expect(page.getByTestId("project-picker")).toBeVisible();

    // The last segment alone would make these one row; each label carries its parent instead.
    const pickerLabels = await page.getByTestId("project-label").allTextContents();
    expect(pickerLabels).toEqual(["work/api", "oss/api"]);
    // The disambiguated label is a convenience, not the identity: each row still shows the path
    // that names the Project, so two rows can never leave the user guessing which is which.
    const pickerPaths = await page.getByTestId("project-path").allTextContents();
    expect(pickerPaths).toEqual([harness.first, harness.second]);

    await projectRow(page, harness.first).click();
    await expect(page.getByTestId("session-drawer")).toBeVisible();
    await expect(page.getByTestId("current-project-label")).toHaveText("work/api");

    await page.getByTestId("project-switch").click();
    const drawerLabels = await page.getByTestId("project-label").allTextContents();
    expect(drawerLabels).toEqual(["work/api", "oss/api"]);

    await projectRow(page, harness.second).click();
    await expect(page.getByTestId("session-drawer")).toHaveAttribute("data-level", "sessions");
    await expect(page.getByTestId("current-project-label")).toHaveText("oss/api");
  } finally {
    await disposeHarness(harness);
  }
});

test("two pages on different Projects do not change each other's view", async ({
  page,
  context,
}) => {
  const harness = await startHarness(REPLY_SCRIPT);
  const secondPage = await context.newPage();
  try {
    await page.goto(projectUrl(harness, harness.first, harness.firstSession.id));
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await secondPage.goto(projectUrl(harness, harness.second, harness.secondSession.id));
    await expect(secondPage.getByTestId("transcript")).toContainText(SECOND_MARKER, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await sendMessage(secondPage, "hello there");
    await expect(secondPage.getByTestId("transcript")).toContainText(
      "reply from the chosen Project",
      { timeout: PI_START_TIMEOUT_MS },
    );

    // The other page's run is not this page's news: its transcript and its list stay on its Project.
    await expect(page.getByTestId("transcript")).toContainText(FIRST_MARKER);
    await expect(page.getByTestId("transcript")).not.toContainText("reply from the chosen Project");
    await openDrawer(page);
    await expect(page.getByTestId("session-row")).toHaveCount(1);
    await expect(page.getByTestId("session-row")).toHaveAttribute(
      "data-session-id",
      harness.firstSession.id,
    );
  } finally {
    await secondPage.close();
    await disposeHarness(harness);
  }
});

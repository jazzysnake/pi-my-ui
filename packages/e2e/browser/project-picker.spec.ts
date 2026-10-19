import { expect, test } from "@playwright/test";

import {
  disposeHarness,
  FIRST_MARKER,
  openBarePage,
  openDrawer,
  projectRow,
  projectUrl,
  REPLY_SCRIPT,
  SECOND_MARKER,
  sendMessage,
  startHarness,
} from "../src/multi-project-harness";

const PI_START_TIMEOUT_MS = 30_000;

// Wiring claim: the picker is the real registry, and choosing a Project fetches that Project's Sessions.
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

// Wiring claim: two pages on one server keep their own Project when either runs a prompt.
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

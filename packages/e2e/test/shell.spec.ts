import { devices, expect, test } from "@playwright/test";

import { startPlaceholderPageServer } from "../src/placeholder-page-server";

test("the pinned phone browser renders a served page", async ({ page }) => {
  const server = await startPlaceholderPageServer();
  try {
    await page.goto(server.url);

    await expect(page.getByRole("heading", { name: "pi-my-ui" })).toBeVisible();
    await expect(page.getByTestId("layer")).toHaveText("browser");
    expect(page.viewportSize()).toEqual(devices["Pixel 5"].viewport);
  } finally {
    await server.close();
  }
});

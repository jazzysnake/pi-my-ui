/** A theme colour as the browser paints it, so a spec asserts the token rather than a copied hex. */

import type { Page } from "@playwright/test";

export type ThemeColorToken = "--color-danger" | "--color-success";

export async function themeColor(page: Page, token: ThemeColorToken): Promise<string> {
  // A probe in the document resolves the custom property to the computed form an element reports,
  // which `getPropertyValue` does not.
  return page.evaluate((name: string) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

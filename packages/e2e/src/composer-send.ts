/** One assertion for the send control's two states: the name a screen reader hears and its glyph. */

import { expect, type Page } from "@playwright/test";

/** The two states the send control alternates between, named as their aria-labels. */
export type SendState = "Send" | "Stop";

const SEND_GLYPH: Readonly<Record<SendState, string>> = {
  Send: "arrow-up",
  Stop: "square",
};

export async function expectComposerSend(page: Page, state: SendState): Promise<void> {
  const control = page.getByTestId("composer-send");
  await expect(control).toHaveAttribute("aria-label", state);
  await expect(control.locator("svg")).toHaveAttribute("data-icon", SEND_GLYPH[state]);
}

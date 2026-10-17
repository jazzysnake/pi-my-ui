/**
 * The touch-target sweep: one definition of "an interactive control" and one measurement of it, so
 * every phone-fit state measures the same set and a new state cannot quietly measure a different one.
 *
 * The rule is a floor on every control a thumb must hit, in every state, so the sweep walks the
 * rendered DOM rather than listing the controls a spec remembers. Two things are deliberately out
 * and both are stated rather than implied:
 *
 *  - an inline `<a href>` inside rendered markdown prose is text, not a control: a 44px inline link
 *    would break the paragraph it lives in;
 *  - an element that is not painted (`display: none`, `visibility: hidden`, clipped away, or
 *    zero-sized) is not tappable at all. `opacity: 0` is *not* excluded — a control a tap reveals is
 *    still a control.
 */

import type { Page } from "@playwright/test";

/** The minimum width and height every interactive control must meet, in CSS px. */
export const MIN_TOUCH_TARGET_PX = 44;

/** One measured control: how a failure message addresses it, and the box it actually rendered. */
export interface ControlBox {
  readonly tag: string;
  /** The control's accessible name: its `aria-label`, else its text. */
  readonly name: string;
  readonly testId: string;
  readonly width: number;
  readonly height: number;
}

const CONTROL_SELECTOR = [
  "button",
  "summary",
  'input:not([type="hidden"])',
  "textarea",
  "select",
  '[role="button"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
  "a[href]",
].join(", ");

/** Every painted control in the page's current layout, measured. */
export async function measureControls(page: Page): Promise<readonly ControlBox[]> {
  return page.evaluate((selector: string) => {
    return [...document.querySelectorAll(selector)].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0) {
        return [];
      }
      if (style.display === "none" || style.visibility === "hidden") {
        return [];
      }
      // `clip-path: inset(50%)` is Tailwind's `sr-only`: present for assistive tech, out of reach of
      // a thumb, and so out of the sweep.
      if (style.clipPath.startsWith("inset")) {
        return [];
      }
      if (element.tagName === "A" && element.closest(".md") !== null) {
        return [];
      }
      const label = element.getAttribute("aria-label") ?? (element.textContent ?? "").trim();
      return [
        {
          tag: element.tagName,
          name: label.slice(0, 60),
          testId: element.getAttribute("data-testid") ?? "",
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        },
      ];
    });
  }, CONTROL_SELECTOR);
}

/**
 * Measure every control in the current state and fail with the whole list of offenders at once, so
 * a second undersized control is never hidden behind the first. `where` names the state, because a
 * failure line has to say which screen was too small.
 */
export async function expectEveryControlMeetsTouchTarget(page: Page, where: string): Promise<void> {
  const controls = await measureControls(page);
  // A sweep that found nothing would pass the assertion below for the wrong reason.
  if (controls.length === 0) {
    throw new Error(`${where}: the sweep found no interactive controls`);
  }
  const undersized = controls.filter(
    (control) => control.width < MIN_TOUCH_TARGET_PX || control.height < MIN_TOUCH_TARGET_PX,
  );
  if (undersized.length > 0) {
    const lines = undersized.map(
      (control) =>
        `  ${control.tag}${control.testId === "" ? "" : `[${control.testId}]`} "${control.name}": ` +
        `${String(control.width)}×${String(control.height)}`,
    );
    throw new Error(
      `${where}: ${String(undersized.length)} control(s) below ` +
        `${String(MIN_TOUCH_TARGET_PX)}×${String(MIN_TOUCH_TARGET_PX)}:\n${lines.join("\n")}`,
    );
  }
  process.stderr.write(`[e2e] touch targets: ${String(controls.length)} controls — ${where}\n`);
}

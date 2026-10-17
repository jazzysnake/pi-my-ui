import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** A scripted run needs at least one step even when the test never prompts the model. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** The narrowest phone in use and the profile the evidence was captured on. */
const STRIP_WIDTHS_PX = [320, 393] as const;
const PHONE_LONG_EDGE_PX = 851;

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    cwd: launch.cwd,
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args: launch.args, env: launch.env, provider: launch.provider, model: launch.model },
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

/**
 * Resolve a palette token through the browser, so a tone is compared against the theme instead of a
 * hex copied into this spec. A component that paints anything else than the palette's tone fails.
 */
async function paletteTone(page: Page, token: string): Promise<string> {
  return page.evaluate((name: string) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, token);
}

interface PaintedTone {
  readonly color: string;
  readonly border: string;
}

async function paintedTone(locator: ReturnType<Page["getByTestId"]>): Promise<PaintedTone> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, border: style.borderTopColor };
  });
}

test("model and thinking read in the accent tone and auto-compact is green only while on", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);
    const accent = await paletteTone(page, "--color-accent");
    const success = await paletteTone(page, "--color-success");
    const dim = await paletteTone(page, "--color-dim");
    const hairline = await paletteTone(page, "--color-hairline-strong");
    // Two tones that resolved to the same value could not tell the states apart.
    expect(accent).not.toBe(dim);
    expect(success).not.toBe(dim);

    const controls = [
      ["model", page.getByTestId("model-picker-toggle")],
      ["thinking", page.getByTestId("thinking-picker-toggle")],
    ] as const;
    for (const [name, control] of controls) {
      const tone = await paintedTone(control);
      expect(tone.color, `the ${name} control reads in the accent tone`).toBe(accent);
      expect(tone.border, `the ${name} control keeps its hairline edge`).toBe(hairline);
    }

    // Drive the toggle through the control, so each state measured is the one pi reported back.
    const toggle = page.getByTestId("auto-compaction-toggle");
    if ((await toggle.getAttribute("data-auto-compaction")) !== "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("data-auto-compaction", "true");
    const on = await paintedTone(toggle);
    expect(on.color, "the on toggle reads in the success tone").toBe(success);
    expect(on.border, "the on toggle outlines itself in the success tone").toBe(success);
    expect(on.color, "the on toggle must not read like a model control").not.toBe(accent);

    await toggle.click();
    await expect(toggle).toHaveAttribute("data-auto-compaction", "false");
    const off = await paintedTone(toggle);
    expect(off.color, "the off toggle reads in the plain tone").toBe(dim);
    expect(off.border, "the off toggle shows no green").not.toBe(success);
  } finally {
    await disposeHarness(harness);
  }
});

test("the status strip fits the narrowest phone and never cuts a label", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);
    for (const width of STRIP_WIDTHS_PX) {
      await page.setViewportSize({ width, height: PHONE_LONG_EDGE_PX });
      const strip = page.getByTestId("composer-status");
      await expect(strip).toBeVisible();

      const measured = await strip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          controls: [...element.querySelectorAll("button")].map((button) => {
            const span = button.querySelector("span");
            return {
              id: button.getAttribute("data-testid") ?? "",
              text: (button.textContent ?? "").trim(),
              // A truncated label reports more content than it shows.
              clipped: span !== null && span.scrollWidth > span.clientWidth + 1,
              outside: button.getBoundingClientRect().right > box.right + 0.5,
            };
          }),
        };
      });

      expect(
        measured.scrollWidth,
        `at ${String(width)}px the strip must not scroll horizontally`,
      ).toBeLessThanOrEqual(measured.clientWidth);
      expect(measured.controls).toHaveLength(3);
      for (const control of measured.controls) {
        expect(control.text, `at ${String(width)}px ${control.id} must show a label`).not.toBe("");
        expect(control.clipped, `at ${String(width)}px ${control.id} must not cut its label`).toBe(
          false,
        );
        expect(
          control.outside,
          `at ${String(width)}px ${control.id} must stay inside the strip`,
        ).toBe(false);
      }
    }

    // The model name is pi's to choose. A name that does not fit must give way itself: the row stays
    // one row, the strip does not scroll, and the toggle stays reachable.
    await page.setViewportSize({ width: STRIP_WIDTHS_PX[0], height: PHONE_LONG_EDGE_PX });
    const longName = await page.getByTestId("composer-status").evaluate((element) => {
      const span = element.querySelector('[data-testid="status-model"]');
      const model = element.querySelector('[data-testid="model-picker-toggle"]');
      if (span !== null) {
        span.textContent = "DeepSeek V4.1 Flash";
      }
      const box = element.getBoundingClientRect();
      const toggle = element.querySelector('[data-testid="auto-compaction-toggle"]');
      return {
        stripScrolls: element.scrollWidth > element.clientWidth,
        modelTruncated: model !== null && model.scrollWidth > model.clientWidth,
        toggleInside: (toggle?.getBoundingClientRect().right ?? Infinity) <= box.right + 0.5,
      };
    });
    expect(longName.stripScrolls, "a long model name must not scroll the strip").toBe(false);
    expect(longName.modelTruncated, "the long model name must ellipsize, not overflow").toBe(true);
    expect(longName.toggleInside, "the toggle must stay on the row").toBe(true);
  } finally {
    await disposeHarness(harness);
  }
});

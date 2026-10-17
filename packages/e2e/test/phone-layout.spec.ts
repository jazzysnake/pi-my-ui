import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** The widths the layout has to hold at: the narrowest phone in use to the widest. */
const PHONE_WIDTHS_PX = [320, 360, 393, 430] as const;
/** The long edge of the suite's phone profile, so a width change keeps the height realistic. */
const PHONE_LONG_EDGE_PX = 851;

const LONG_CODE_LINE = `const panorama = "${"far".repeat(80)}";`;
const LONG_URL = `https://example.invalid/${"very-long-path-segment/".repeat(8)}`;
const WIDE_TABLE = [
  "| surface | state | owner | last change | note | calls | retries | budget |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| transcript | streaming | main | a moment ago | rendered from the Projection | 12 | 0 | 40k |",
].join("\n");

/** A reply whose every wide shape has to stay inside the phone. */
const WIDE_REPLY = [
  "# Wide content",
  "",
  `A long unbroken URL: ${LONG_URL}`,
  "",
  WIDE_TABLE,
  "",
  "```ts",
  LONG_CODE_LINE,
  "```",
].join("\n");

/** Bash output long enough that a single line would widen anything that lays it out unwrapped. */
const LONG_BASH_OUTPUT = `!printf '%0.sx' $(seq 1 300)`;

const WIDE_SCRIPT: Script = [
  {
    expect: { role: "user", text: "show the wide content" },
    reply: { content: [{ type: "text", text: WIDE_REPLY }], stopReason: "stop" },
  },
];

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(script: Script, seed: SeedName): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, seed);
  const launch = await scriptedPiLaunch(home, script);
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

/** Open the seeded Session through the built client, the way Caddy serves it in production. */
async function openHarness(page: Page, harness: Harness, marker: string): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(harness.seeded.id)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("transcript")).toContainText(marker);
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}

test("wide content scrolls inside itself and never widens the page at any phone width", async ({
  page,
}) => {
  const harness = await startHarness(WIDE_SCRIPT, "plain");
  try {
    await openHarness(page, harness, "Seed text block 3.");
    await sendMessage(page, "show the wide content");
    await expect(page.getByTestId("markdown").getByRole("table")).toBeVisible();
    await expect(page.getByTestId("markdown").locator("pre")).toContainText("const panorama");

    await sendMessage(page, LONG_BASH_OUTPUT);
    await expect(page.getByTestId("bash-card")).toHaveAttribute("data-bash-status", "ok");

    for (const width of PHONE_WIDTHS_PX) {
      await page.setViewportSize({ width, height: PHONE_LONG_EDGE_PX });

      // The unbroken URL wraps instead of widening anything: more than one line box per paragraph
      // only happens when it broke.
      const urlLines = await page.evaluate((url: string) => {
        const paragraph = [...document.querySelectorAll(".md p")].find((element) =>
          (element.textContent ?? "").includes(url),
        );
        if (paragraph === undefined) {
          return 0;
        }
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        return range.getClientRects().length;
      }, LONG_URL);
      expect(urlLines, `at ${String(width)}px the unbroken URL must wrap`).toBeGreaterThan(1);

      // The code block is genuinely wider than the phone and scrolls inside its own box.
      const code = await page
        .getByTestId("markdown")
        .locator("pre")
        .first()
        .evaluate((element) => ({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }));
      expect(
        code.scrollWidth,
        `at ${String(width)}px the code line must really be too long`,
      ).toBeGreaterThan(code.clientWidth);

      const measured = await page.evaluate(() => {
        const transcript = document.querySelector('[data-testid="transcript"]');
        return {
          documentScrollWidth: document.documentElement.scrollWidth,
          documentClientWidth: document.documentElement.clientWidth,
          transcriptScrollWidth: transcript?.scrollWidth ?? 0,
          transcriptClientWidth: transcript?.clientWidth ?? 0,
        };
      });
      expect(
        measured.documentScrollWidth,
        `at ${String(width)}px: the page must not scroll horizontally`,
      ).toBeLessThanOrEqual(measured.documentClientWidth);
      expect(
        measured.transcriptScrollWidth,
        `at ${String(width)}px: the transcript must not scroll horizontally`,
      ).toBeLessThanOrEqual(measured.transcriptClientWidth);
      process.stderr.write(
        `[e2e] ${String(width)}px: page ${String(measured.documentScrollWidth)}/` +
          `${String(measured.documentClientWidth)}, transcript ` +
          `${String(measured.transcriptScrollWidth)}/${String(measured.transcriptClientWidth)}, ` +
          `code ${String(code.scrollWidth)}/${String(code.clientWidth)}, url ${String(urlLines)} lines\n`,
      );
    }
    await page.setViewportSize({ width: PHONE_WIDTHS_PX[0], height: PHONE_LONG_EDGE_PX });
  } finally {
    await disposeHarness(harness);
  }
});

test("a drawer scrolls itself and never the page or the transcript behind it", async ({ page }) => {
  const harness = await startHarness(
    [
      {
        expect: { role: "user", text: "a prompt this recording never saw" },
        reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
      },
    ],
    "large",
  );
  try {
    await openHarness(page, harness, "Seed text block");
    const transcript = page.getByTestId("transcript");

    // Put the transcript somewhere in the middle, so "the page behind did not move" is falsifiable.
    // A wheel scroll is animated, so the baseline waits for it to come to rest.
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, -1_200);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({
      transcriptScrollTop: document.querySelector('[data-testid="transcript"]')?.scrollTop ?? 0,
      scrollY: window.scrollY,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
    }));
    expect(before.transcriptScrollTop).toBeGreaterThan(0);
    // The shell is one viewport tall and clips, so the document has no scroll range to give away.
    expect(before.documentScrollHeight).toBeLessThanOrEqual(before.documentClientHeight + 1);
    expect(before.scrollY).toBe(0);

    await page.getByTestId("sessions-toggle").click();
    await expect(page.getByTestId("session-drawer")).toBeVisible();

    // The gesture a thumb makes over the drawer: nothing behind it may move.
    await page.mouse.move(120, 400);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(150);
    const during = await page.evaluate(() => ({
      transcriptScrollTop: document.querySelector('[data-testid="transcript"]')?.scrollTop ?? 0,
      scrollY: window.scrollY,
      documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
    }));
    expect(during.scrollY).toBe(0);
    expect(during.documentScrollTop).toBe(0);
    expect(during.transcriptScrollTop, "the transcript behind the drawer must not move").toBe(
      before.transcriptScrollTop,
    );

    // Non-vacuity: the same wheel gesture does scroll the transcript once the drawer is gone, so the
    // containment above is the drawer's, not a wheel event that went nowhere.
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();
    await expect(page.getByTestId("session-drawer")).toHaveCount(0);
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(150);
    const after = await transcript.evaluate((element) => element.scrollTop);
    expect(after).not.toBe(before.transcriptScrollTop);
  } finally {
    await disposeHarness(harness);
  }
});

test("the top bar holds its controls inside the narrowest phone", async ({ page }) => {
  // The subagents seed carries every header element at once — the agent pill and a context readout
  // beside the navigation controls — which is the widest the top of the screen ever gets.
  const harness = await startHarness(
    [
      {
        expect: { role: "user", text: "a prompt this recording never saw" },
        reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
      },
    ],
    "subagents",
  );
  try {
    await openHarness(page, harness, "Seed text block 9.");
    await expect(page.getByTestId("agent-pill")).toBeVisible();

    await page.setViewportSize({ width: PHONE_WIDTHS_PX[0], height: PHONE_LONG_EDGE_PX });
    const header = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="top-bar"]');
      const controls = [
        ...(bar?.querySelectorAll('button, [data-testid="connection-status"]') ?? []),
      ];
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        offscreen: controls
          .map((control) => control.getBoundingClientRect())
          .filter((rect) => rect.left < 0 || rect.right > window.innerWidth)
          .map((rect) => `${String(Math.round(rect.left))}..${String(Math.round(rect.right))}`),
      };
    });
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
    expect(header.offscreen, "header controls outside the viewport").toEqual([]);
  } finally {
    await disposeHarness(harness);
  }
});

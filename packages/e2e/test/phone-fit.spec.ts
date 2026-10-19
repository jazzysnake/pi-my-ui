import { expect, test, type Page } from "@playwright/test";

import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { expectComposerSend } from "../src/composer-send";
import { PALETTE } from "../src/palette";
import { seedSession, type FixtureSession, type SeedName } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

/** A run that stays in flight, so the states that exist only mid-run can be measured. */
const RUNNING_SCRIPT: Script = [
  {
    expect: { role: "user", text: "hold the run open" },
    reply: {
      content: [
        { type: "text", text: "Holding the run open." },
        { type: "toolCall", id: "call_hold", name: "bash", arguments: { command: "sleep 5" } },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "bash" },
    reply: { content: [{ type: "text", text: "the wait is over" }], stopReason: "stop" },
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
    projects: [launch.cwd],
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

test("the shell is drawn in the console theme: palette, monospace type and composer geometry", async ({
  page,
}) => {
  // The subagents seed carries the session bar's widest content — the agent pill and the context
  // readout on one row — which is the widest the top of the screen ever gets.
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

    // The palette and the type ramp are the design direction's, restated as rendered values so the
    // assertion has a source outside the implementation.
    const shell = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        background: style.backgroundColor,
        foreground: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    });
    expect(shell.background).toBe(PALETTE.canvas);
    expect(shell.foreground).toBe(PALETTE.ink);
    expect(shell.fontFamily).toContain("ui-monospace");
    expect(shell.fontSize).toBe("12.5px");
    expect(shell.lineHeight).toBe("18.75px");

    const geometry = await page.evaluate(() => {
      const read = (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        if (element === null) {
          return null;
        }
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          foreground: style.color,
          radius: Number.parseFloat(style.borderTopLeftRadius),
          width: element.getBoundingClientRect().width,
        };
      };
      return { send: read("composer-send"), branch: read("composer-branch") };
    });

    // The composer's round send control in the palette's green, and its square branch control.
    // `rounded-full` resolves to a radius of at least half the box, which is what makes it a circle.
    expect(geometry.send?.radius).toBeGreaterThanOrEqual((geometry.send?.width ?? 0) / 2);
    expect(geometry.send?.background).toBe(PALETTE.success);
    expect(geometry.send?.foreground).toBe(PALETTE.canvas);
    expect(geometry.branch?.radius).toBe(14);

    // The context readout lives in the session bar, apart from the composer's choosers.
    await expect(page.getByTestId("session-bar").getByTestId("context-usage")).toBeVisible();
  } finally {
    await disposeHarness(harness);
  }
});

test("reduced motion stops the pulse and loses no text", async ({ page }) => {
  const harness = await startHarness(RUNNING_SCRIPT, "plain");
  try {
    await openHarness(page, harness, "Seed text block 3.");
    await sendMessage(page, "hold the run open");

    const toolStatus = page.locator(
      '[data-tool-status="running"] [data-testid="tool-card-status"]',
    );
    await expect(toolStatus).toBeVisible();
    await expect(toolStatus).toHaveText("Running");

    // A live run is announced by the transcript's growth and by the send control turning into the
    // stop control, whose name carries the run's state.
    await expectComposerSend(page, "Stop");

    const animationName = (locator: ReturnType<Page["locator"]>): Promise<string> =>
      locator.evaluate((element) => getComputedStyle(element).animationName);

    // The pulse is really there, so the assertion below is not vacuous.
    expect(await animationName(toolStatus)).toBe("pulse");

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await animationName(toolStatus)).toBe("none");

    // Nothing is lost when the animation goes: the status still says the same fact in text, and a
    // tap on the composer's control still does what it says.
    await expect(toolStatus).toHaveText("Running");
    await expectComposerSend(page, "Stop");
    await page.getByTestId("composer-send").click();
    await expectComposerSend(page, "Send");
  } finally {
    await disposeHarness(harness);
  }
});

test("an overlay covers nothing it cannot act on, and a hidden label holds no tap", async ({
  page,
}) => {
  const harness = await startHarness(
    [
      {
        expect: { role: "user", text: "a prompt this recording never saw" },
        reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
      },
    ],
    "plain",
  );
  try {
    await openHarness(page, harness, "Seed text block 3.");

    // A tap over the status label's own rectangle must reach the control under it: the label is
    // revealed on tap, never a layer that eats the tap that revealed it.
    const hiddenLabel = await page.evaluate(() => {
      const label = document.querySelector('[data-testid="connection-status-label"]');
      if (label === null) {
        return null;
      }
      const rect = label.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        opacity: getComputedStyle(label).opacity,
        hitTestId: hit?.getAttribute("data-testid") ?? hit?.tagName ?? "none",
        hitIsLabel: hit === label || label.contains(hit),
      };
    });
    expect(hiddenLabel?.opacity).toBe("0");
    expect(hiddenLabel?.hitIsLabel, "the hidden label swallowed the tap beneath it").toBe(false);
    expect(hiddenLabel?.hitTestId).not.toBe("none");

    await page.getByTestId("sessions-toggle").click();
    await expect(page.getByTestId("session-drawer")).toBeVisible();

    // Every point an overlay covers resolves to something in it that acts: its own content, or the
    // scrim that dismisses it. A dead point would be a tap swallowed with nothing to show for it.
    const points = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="session-drawer"]');
      const overlay = panel?.parentElement ?? null;
      if (panel === null || overlay === null) {
        return null;
      }
      const rect = overlay.getBoundingClientRect();
      const sampled: { where: "panel" | "scrim" | "outside"; testId: string }[] = [];
      for (const fx of [0.05, 0.3, 0.5, 0.7, 0.95]) {
        for (const fy of [0.05, 0.3, 0.5, 0.7, 0.95]) {
          const hit = document.elementFromPoint(
            rect.x + rect.width * fx,
            rect.y + rect.height * fy,
          );
          if (hit === null) {
            sampled.push({ where: "outside", testId: "none" });
            continue;
          }
          const testId = hit.getAttribute("data-testid") ?? hit.tagName;
          if (panel.contains(hit)) {
            sampled.push({ where: "panel", testId });
          } else if (hit.closest("button") !== null && overlay.contains(hit)) {
            sampled.push({ where: "scrim", testId });
          } else {
            // Nothing in the overlay answered this point: a dead layer, or the shell showing through.
            sampled.push({ where: "outside", testId });
          }
        }
      }
      return { width: rect.width, height: rect.height, sampled };
    });
    expect(points).not.toBeNull();
    // The overlay really does span the screen, so the sampling was not over one corner of it.
    expect(points?.width).toBe(await page.evaluate(() => window.innerWidth));
    expect(points?.height).toBe(await page.evaluate(() => window.innerHeight));
    const escaped = (points?.sampled ?? []).filter((point) => point.where === "outside");
    expect(escaped, "points no part of the overlay answered").toEqual([]);
    // Both kinds of point were sampled, so the assertion above is about a scrim and a panel.
    expect((points?.sampled ?? []).some((point) => point.where === "panel")).toBe(true);
    expect((points?.sampled ?? []).some((point) => point.where === "scrim")).toBe(true);

    // A tap the overlay does swallow is a dismissal, and the control beneath works afterwards.
    await page.getByRole("button", { name: "Close sessions sidebar" }).click();
    await expect(page.getByTestId("session-drawer")).toHaveCount(0);
    await page.getByTestId("composer-input").fill("still tappable");
    await expect(page.getByTestId("composer-input")).toHaveValue("still tappable");
  } finally {
    await disposeHarness(harness);
  }
});

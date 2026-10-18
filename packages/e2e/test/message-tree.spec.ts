import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import type { ServerMessage, SessionTree, TreeNode } from "@pi-my-ui/protocol";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import {
  generateSession,
  seedSession,
  type FixtureSession,
  type SeedName,
} from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";
import { readAttachSurfaces } from "../src/ws-transcript";

const PI_TEST_TIMEOUT_MS = 120_000;
const PI_START_TIMEOUT_MS = 30_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** Never invoked: these tests browse one Session's tree and move its Leaf, they run no turn. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "unused" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** The branching seed's texts: the Leaf, an abandoned branch, and a message to edit and resubmit. */
const LEAF_TEXT = "Seed text block 32.";
const EDIT_TEXT = "Seed text block 20.";
const KEPT_BEFORE_EDIT = "Seed text block 19.";
const ABANDONED_MODEL = "deepseek-flash";
const SYSTEM_TEXT = "Seed system prompt 1.";

interface Harness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

async function startHarness(seed: SeedName = "branching"): Promise<Harness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, seed);
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
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

async function openHarness(page: Page, harness: Harness, sessionId: string): Promise<void> {
  const url = `${harness.client.url}?session=${encodeURIComponent(sessionId)}&ws=${encodeURIComponent(harness.server.url)}`;
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

function modal(page: Page) {
  return page.getByTestId("message-tree-modal");
}

/** A tree row, scoped to the modal: the transcript's entries carry ids too. */
function row(page: Page, text: string) {
  return modal(page).getByTestId("message-tree-row").filter({ hasText: text });
}

function select(page: Page, text: string): Promise<void> {
  return row(page, text).getByTestId("message-tree-select").click();
}

/** How many hidden rows a toggle tells the user it will reveal, read from its own label. */
function announcedRows(label: string | null): number | null {
  const stated = /\d+/.exec(label ?? "");
  return stated === null ? null : Number(stated[0]);
}

function flatten(nodes: readonly TreeNode[], found: TreeNode[] = []): TreeNode[] {
  for (const node of nodes) {
    found.push(node);
    flatten(node.children, found);
  }
  return found;
}

/** The next frame of one type; the server also pushes lists and attach surfaces on its own. */
async function nextOf<T extends ServerMessage["type"]>(
  client: Awaited<ReturnType<typeof connectWsSession>>,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  for (;;) {
    const message = await client.next();
    if (message.type === type) {
      return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

test("both entry points open one modal that collapses alternatives and searches the whole tree", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness, harness.seeded.id);
    await expect(page.getByTestId("transcript")).toContainText(LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });

    // Path one: the typed command.
    await page.getByTestId("composer-input").fill("/tree");
    await page.getByTestId("composer-send").click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page)).toHaveAttribute("role", "dialog");
    // The Leaf is marked where pi put it, which for a seeded Session can be an entry the transcript
    // has no row for: the tree is pi's, not the transcript's.
    await expect(
      modal(page).locator('[data-testid="message-tree-row"][data-leaf="true"]'),
    ).toHaveAttribute("data-entry-id", harness.seeded.leafId ?? "");
    await expect(row(page, LEAF_TEXT).getByTestId("message-tree-current")).toHaveCount(0);
    // The active path is marked and the abandoned branch is not.
    await expect(row(page, KEPT_BEFORE_EDIT)).toHaveAttribute("data-active", "true");
    await expect(row(page, "Seed text block 2.")).toHaveAttribute("data-active", "false");

    // Every row leads with the glyph for its kind, and a user row carries the fork control.
    const glyphOf = (text: string) =>
      row(page, text).locator('[data-testid="message-tree-select"] svg');
    await expect(glyphOf(EDIT_TEXT)).toHaveAttribute("data-icon", "user");
    await expect(glyphOf(KEPT_BEFORE_EDIT)).toHaveAttribute("data-icon", "bot");
    await expect(glyphOf("Seed text block 16.")).toHaveAttribute("data-icon", "hammer");
    await expect(glyphOf(SYSTEM_TEXT)).toHaveAttribute("data-icon", "dot");

    // Row markers size to their row (16 px) rather than to a control, on the pack's grid and stroke.
    const glyphs = await modal(page)
      .locator('[data-testid="message-tree-select"] svg')
      .evaluateAll((icons) =>
        icons.map((icon) => {
          const box = icon.getBoundingClientRect();
          return {
            icon: icon.getAttribute("data-icon"),
            viewBox: icon.getAttribute("viewBox"),
            stroke: icon.getAttribute("stroke-width"),
            width: box.width,
            height: box.height,
          };
        }),
      );
    expect(glyphs.length).toBeGreaterThan(1);
    for (const glyph of glyphs) {
      expect(glyph.icon).not.toBeNull();
      expect(glyph.viewBox).toBe("0 0 24 24");
      expect(glyph.stroke).toBe("2");
      expect(glyph.width).toBeCloseTo(16, 1);
      expect(glyph.height).toBeCloseTo(16, 1);
    }
    await expect(
      row(page, EDIT_TEXT).getByTestId("message-tree-fork").locator("svg"),
    ).toHaveAttribute("data-icon", "git-fork");
    await expect(row(page, KEPT_BEFORE_EDIT).getByTestId("message-tree-fork")).toHaveCount(0);
    await expect(page.getByTestId("message-tree-close").locator("svg")).toHaveAttribute(
      "data-icon",
      "x",
    );

    // The only branch point on the path is expanded, and collapsing it counts what a tap will
    // reveal: every alternative hangs off the active path collapsed.
    const forkToggle = row(page, SYSTEM_TEXT).getByTestId("message-tree-toggle");
    await expect(forkToggle).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "Seed text block 2.")).toBeVisible();
    const expandedRows = await page.getByTestId("message-tree-row").count();
    await forkToggle.click();
    await expect(forkToggle).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "Seed text block 2.")).toHaveCount(0);
    // Collapsing hides everything below the row, not just its two branches, and the count it states
    // is exactly what a tap gives back.
    const collapsedRows = await page.getByTestId("message-tree-row").count();
    expect(announcedRows(await forkToggle.getAttribute("aria-label"))).toBe(
      expandedRows - collapsedRows,
    );
    await forkToggle.click();
    await expect(row(page, "Seed text block 2.")).toBeVisible();
    await expect(page.getByTestId("message-tree-row")).toHaveCount(expandedRows);

    // Search reaches the abandoned branch, which the collapsed default hides.
    await expect(row(page, ABANDONED_MODEL)).toHaveCount(0);
    await page.getByTestId("message-tree-search").fill(ABANDONED_MODEL);
    const matches = modal(page).getByTestId("message-tree-match");
    await expect(matches).toHaveCount(1);
    await matches.first().click();
    await expect(page.getByTestId("message-tree-search")).toHaveValue("");
    await expect(row(page, ABANDONED_MODEL)).toBeVisible();
    await expect(row(page, ABANDONED_MODEL)).toHaveAttribute("data-highlighted", "true");

    // No horizontal scroll: one line per node on a phone.
    const overflows = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="message-tree-body"]');
      return body === null ? false : body.scrollWidth > body.clientWidth + 1;
    });
    expect(overflows).toBe(false);

    // Path two: the composer's branch control opens that same dialog.
    await page.getByTestId("message-tree-close").click();
    await expect(modal(page)).toHaveCount(0);
    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page)).toHaveAttribute("aria-label", "Message tree");
    await expect(page.getByTestId("message-tree-search")).toBeVisible();
  } finally {
    await disposeHarness(harness);
  }
});

test("selecting a message moves the Leaf, follows it in the transcript and keeps the old branch", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness, harness.seeded.id);
    await expect(page.getByTestId("transcript")).toContainText(LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    // A user message hands its exact text back to the composer for edit and resubmit.
    await select(page, EDIT_TEXT);
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toHaveValue(EDIT_TEXT);

    // The transcript followed the server-confirmed Leaf: the branch it moved off is gone from it.
    await expect(page.getByTestId("transcript")).toContainText(KEPT_BEFORE_EDIT);
    await expect(page.getByTestId("transcript")).not.toContainText(LEAF_TEXT);

    // The abandoned branch is still in the tree, so a move destroyed nothing.
    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await expect(row(page, LEAF_TEXT)).toHaveCount(0);
    await page.getByTestId("message-tree-search").fill(LEAF_TEXT);
    await expect(modal(page).getByTestId("message-tree-match")).toHaveCount(1);
  } finally {
    await disposeHarness(harness);
  }
});

test("one tap opens a whole abandoned branch, not one message of it", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness, harness.seeded.id);
    await expect(page.getByTestId("transcript")).toContainText(LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });

    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    // The abandoned branch is an alternative, so it starts collapsed: one row for its head and
    // nothing of what it holds.
    const offPathRows = modal(page).locator(
      '[data-testid="message-tree-row"][data-active="false"]',
    );
    const head = row(page, "Seed text block 2.");
    await expect(head).toHaveAttribute("data-active", "false");
    const reveal = head.getByTestId("message-tree-toggle");
    await expect(reveal).toHaveAttribute("aria-expanded", "false");
    await expect(offPathRows).toHaveCount(1);
    await expect(row(page, ABANDONED_MODEL)).toHaveCount(0);
    const announced = announcedRows(await reveal.getAttribute("aria-label"));

    // One tap opens the run of the abandoned branch through to the entry it ends at. Walking back
    // along a branch the Session left is how the Leaf moves between branches, so one tap per
    // message in it is the bug, not the design.
    await reveal.click();
    await expect(reveal).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, ABANDONED_MODEL)).toBeVisible();
    expect(await offPathRows.count()).toBe(1 + (announced ?? 0));

    // Collapsing the head closes the run again: browsing destroyed nothing either way.
    await reveal.click();
    await expect(offPathRows).toHaveCount(1);
    await expect(row(page, ABANDONED_MODEL)).toHaveCount(0);
    await expect(head).toBeVisible();
  } finally {
    await disposeHarness(harness);
  }
});

test("one tap on the row past a new Leaf reveals the branch behind it in full", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness, harness.seeded.id);
    await expect(page.getByTestId("transcript")).toContainText(LEAF_TEXT, {
      timeout: PI_START_TIMEOUT_MS,
    });

    // Move the Leaf back the way the owner does: open the tree and take an earlier message.
    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await select(page, EDIT_TEXT);
    await expect(modal(page)).toHaveCount(0);

    // Reopening shows only the active path: the branch that was left hangs off the new Leaf
    // collapsed, so the Leaf it came from is not on screen.
    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    const head = row(page, EDIT_TEXT);
    await expect(head).toHaveAttribute("data-active", "false");
    await expect(row(page, LEAF_TEXT)).toHaveCount(0);
    const reveal = head.getByTestId("message-tree-toggle");
    await expect(reveal).toHaveAttribute("aria-expanded", "false");
    const announced = announcedRows(await reveal.getAttribute("aria-label"));
    const shown = await page.getByTestId("message-tree-row").count();

    // One tap walks the whole run back to the Leaf the Session came from, and reveals exactly as
    // many rows as the control said it would.
    await reveal.click();
    await expect(row(page, LEAF_TEXT)).toBeVisible();
    expect((await page.getByTestId("message-tree-row").count()) - shown).toBe(announced);
  } finally {
    await disposeHarness(harness);
  }
});

test("a linear Session opens the whole tree with no toggles", async ({ page }) => {
  const harness = await startHarness("plain");
  try {
    await openHarness(page, harness, harness.seeded.id);
    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await expect(page.getByTestId("message-tree-row").first()).toBeVisible();

    // One path and no alternatives: every entry is already on screen, so no row offers to open
    // anything and none of them indents as if it nested.
    const geometry = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="message-tree-row"]')];
      const depths = new Set(rows.map((row) => row.getAttribute("data-depth")));
      return {
        rows: rows.length,
        toggles: document.querySelectorAll('[data-testid="message-tree-toggle"]').length,
        depths: [...depths],
      };
    });
    expect(geometry.rows).toBe(harness.seeded.entryCount);
    expect(geometry.toggles).toBe(0);
    expect(geometry.depths).toEqual(["0"]);
  } finally {
    await disposeHarness(harness);
  }
});

test("a hidden custom message has no tree row, exactly as the transcript has none", async ({
  page,
}) => {
  const home = await createHermeticHome();
  const generated = await generateSession(home, "transcript", {
    transcriptEntries: 8,
    hiddenCustomMessage: true,
  });
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args: launch.args, env: launch.env, provider: launch.provider, model: launch.model },
  });
  const client = await startClientPageServer();
  const harness: Harness = { home, seeded: generated, server, client };
  try {
    await openHarness(page, harness, generated.id);
    await expect(page.getByTestId("transcript")).toContainText("Generated user message 0.", {
      timeout: PI_START_TIMEOUT_MS,
    });
    await expect(page.getByTestId("transcript")).not.toContainText("hidden custom message");

    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await expect(page.getByTestId("message-tree-row").first()).toBeVisible();
    // The hidden entry is a real Session entry, so the tree holds one row fewer than the file and
    // no row carries the text the transcript also refuses to draw.
    expect(await page.getByTestId("message-tree-row").count()).toBe(generated.entryCount - 1);
    await expect(modal(page)).not.toContainText("hidden custom message");
  } finally {
    await disposeHarness(harness);
  }
});

test("a Leaf move is confirmed by pi, and an unconfirmed one is refused honestly", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const fileBytes = await readFile(harness.seeded.path, "utf8");
    client.send({ type: "subscribe", sessionId: harness.seeded.id });
    const snapshot = await nextOf(client, "snapshot");
    await readAttachSurfaces(client);

    client.send({ type: "getTree", sessionId: harness.seeded.id });
    const tree: SessionTree = (await nextOf(client, "sessionTree")).tree;
    expect(tree.leafId).toBe(harness.seeded.leafId);
    const nodes = flatten(tree.roots);
    const edited = nodes.find((node) => node.entry.text === EDIT_TEXT);
    expect(edited?.entry.role).toBe("user");
    if (edited === undefined) {
      return;
    }

    client.send({ type: "moveLeaf", sessionId: harness.seeded.id, entryId: edited.entry.id });
    const confirmed = await nextOf(client, "leafMoved");
    // pi moves a user message's Leaf to its parent, which is what makes it resubmittable.
    expect(confirmed.entryId).toBe(edited.entry.id);
    expect(confirmed.leafId).toBe(edited.entry.parentId);
    expect(confirmed.leafId).not.toBe(snapshot.projection.leafId);

    // A moved Leaf is a pointer, not an edit: the Session file is exactly as it was, so the branch
    // the Session left is still there.
    expect(await readFile(harness.seeded.path, "utf8")).toBe(fileBytes);

    // An id this Session does not hold is refused, with the entry named so the client can attach the
    // refusal to the row that asked.
    client.send({ type: "moveLeaf", sessionId: harness.seeded.id, entryId: "not-an-entry" });
    const refused = await nextOf(client, "error");
    expect(refused.error.code).toBe("commandFailed");
    expect(refused.error.detail).toBe("not-an-entry");
    expect(refused.sessionId).toBe(harness.seeded.id);

    // The refusal left the Leaf where the confirmed move put it.
    client.send({ type: "getTree", sessionId: harness.seeded.id });
    expect((await nextOf(client, "sessionTree")).tree.leafId).toBe(confirmed.leafId);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("a 100-deep Session renders flat and every visible row is one tap away", async ({ page }) => {
  const home = await createHermeticHome();
  const deep = await generateSession(home, "deep-tree");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [launch.cwd],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: { args: launch.args, env: launch.env, provider: launch.provider, model: launch.model },
  });
  const client = await startClientPageServer();
  const harness: Harness = { home, seeded: deep, server, client };
  try {
    await openHarness(page, harness, deep.id);
    await page.getByTestId("composer-branch").click();
    await expect(modal(page)).toBeVisible();
    await expect(page.getByTestId("message-tree-row").first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="message-tree-body"]');
      const rows = [...document.querySelectorAll('[data-testid="message-tree-row"]')];
      let deepest = 0;
      for (const element of rows) {
        deepest = Math.max(deepest, Number(element.getAttribute("data-depth") ?? "0"));
      }
      return {
        rows: rows.length,
        deepest,
        overflows: body === null ? false : body.scrollWidth > body.clientWidth + 1,
      };
    });
    // A continuation is not a branch point, so a 100-deep chain stays near the top level and never
    // widens the page: the staircase that made a deep Session unnavigable on a phone is gone. Only
    // the two real branch points on the active path step in, by one level each.
    expect(geometry.rows).toBeGreaterThan(60);
    expect(geometry.deepest).toBeLessThanOrEqual(2);
    expect(geometry.overflows).toBe(false);

    // A row deep in the chain is reachable with one tap: its text comes back to the composer.
    const deepText = "Generated user message 60.";
    await expect(row(page, deepText)).toBeVisible();
    await select(page, deepText);
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toHaveValue(deepText);
  } finally {
    await client.close();
    await server.close();
    await home.dispose();
  }
});

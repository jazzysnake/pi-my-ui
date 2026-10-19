import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_MAX_BYTES } from "@pi-my-ui/protocol";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { startClientPageServer, type ClientPageServer } from "../src/client-page-server";
import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";

const DOWNLOAD_EVENT_TIMEOUT_MS = 10_000;

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

const README_TEXT = "Example project readme.";
/** A file larger than a preview renders, so the truncation note is exercised. */
const BIG_TEXT = "line\n".repeat(PREVIEW_MAX_BYTES);

interface Harness {
  readonly home: HermeticHome;
  readonly project: string;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

/**
 * A working tree with a directory, a text file, an oversized text file, a file no other Project has,
 * and symlinks that leave the served root. The out-of-root targets live beside the workspace, so a
 * traversal or a symlink escape would reach them if the server did not refuse.
 */
async function writeWorkspace(home: HermeticHome): Promise<void> {
  await mkdir(join(home.workspace, "src"), { recursive: true });
  await writeFile(join(home.workspace, "README.md"), `${README_TEXT}\n`, "utf8");
  await writeFile(join(home.workspace, "src", "index.ts"), "export const x = 1;\n", "utf8");
  await writeFile(join(home.workspace, "big.txt"), BIG_TEXT, "utf8");
  await writeFile(join(home.workspace, "only-in-first.txt"), "first project only\n", "utf8");
  await writeFile(join(home.root, "outside.txt"), "outside the root\n", "utf8");
  await mkdir(join(home.root, "outside-dir"), { recursive: true });
  await symlink(join(home.root, "outside.txt"), join(home.workspace, "escape.txt"));
  await symlink(join(home.root, "outside-dir"), join(home.workspace, "escape-dir"));
}

async function startHarness(): Promise<Harness> {
  const home = await createHermeticHome();
  await writeWorkspace(home);
  const project = await realpath(home.workspace);
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [project],
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
  });
  const client = await startClientPageServer();
  return { home, project, seeded, server, client };
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

/** One download-route request carrying the query a file request would send. */
function download(
  server: RunningServer,
  query: string,
  options: { readonly origin: string; readonly method: string },
): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${server.httpUrl}/files/download?${query}`,
      { method: options.method, headers: { origin: options.origin } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

// Wiring claim: a real Project tree lists lazily, downloads through the browser and previews with truncation.
test("browses, expands, downloads and previews files from the chosen Project", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openHarness(page, harness);

    // The client page is served from a different origin than the backend, so a loopback origin is
    // what the download route's trust check sees; the same page origin is passed as the Origin.
    const pageOrigin = new URL(harness.client.url).origin;
    const post = { origin: pageOrigin, method: "POST" } as const;

    await page.getByTestId("files-toggle").click();
    await expect(page.getByTestId("file-tree")).toBeVisible();
    await expect(page.getByTestId("file-tree-root")).toHaveText(harness.project);

    // Directories are listed before files, and a directory's children are not fetched until it is
    // expanded.
    await expect(page.getByTestId("file-tree-directory").filter({ hasText: "src/" })).toBeVisible();
    await expect(page.getByTestId("file-tree-file").filter({ hasText: "README.md" })).toBeVisible();
    await expect(page.getByTestId("file-tree-file").filter({ hasText: "index.ts" })).toHaveCount(0);

    await page.getByTestId("file-tree-directory").filter({ hasText: "src/" }).click();
    await expect(page.getByTestId("file-tree-file").filter({ hasText: "index.ts" })).toBeVisible();

    // Tapping a file row downloads it through the browser's normal flow.
    const downloadPromise = page.waitForEvent("download", { timeout: DOWNLOAD_EVENT_TIMEOUT_MS });
    await page.getByTestId("file-tree-file").filter({ hasText: "README.md" }).click();
    const saved = await downloadPromise;
    expect(saved.suggestedFilename()).toBe("README.md");

    // A text-like file previews inline.
    await page.getByRole("button", { name: "Preview README.md" }).click();
    await expect(page.getByTestId("file-preview-text")).toContainText(README_TEXT);
    await expect(page.getByTestId("file-preview-truncated")).toHaveCount(0);
    await page.getByTestId("file-preview-close").click();
    await expect(page.getByTestId("file-preview")).toBeHidden();

    // A preview larger than the bound says so rather than silently showing a prefix.
    await page.getByRole("button", { name: "Preview big.txt" }).click();
    await expect(page.getByTestId("file-preview-truncated")).toContainText("truncated");

    // The origin the browser sends is trusted on the download route; the harness page is loopback.
    const own = await download(
      harness.server,
      new URLSearchParams({ project: harness.project, path: "README.md" }).toString(),
      post,
    );
    expect(own).toEqual({ status: 200, body: `${README_TEXT}\n` });
  } finally {
    await disposeHarness(harness);
  }
});

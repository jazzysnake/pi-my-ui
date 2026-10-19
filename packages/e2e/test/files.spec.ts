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
import { connectWsSession } from "../src/ws-session-client";
import { readAttachSurfaces } from "../src/ws-transcript";

const DOWNLOAD_EVENT_TIMEOUT_MS = 10_000;

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

const README_TEXT = "Example project readme.";
const SECOND_README_TEXT = "Second project readme.";
const ONLY_FIRST = "first project only";
/** A file larger than a preview renders, so the truncation note is exercised. */
const BIG_TEXT = "line\n".repeat(PREVIEW_MAX_BYTES);

interface Harness {
  readonly home: HermeticHome;
  readonly project: string;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly client: ClientPageServer;
}

interface TwoProjectHarness {
  readonly home: HermeticHome;
  readonly first: string;
  readonly second: string;
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
  await writeFile(join(home.workspace, "only-in-first.txt"), `${ONLY_FIRST}\n`, "utf8");
  await writeFile(join(home.root, "outside.txt"), "outside the root\n", "utf8");
  await mkdir(join(home.root, "outside-dir"), { recursive: true });
  await symlink(join(home.root, "outside.txt"), join(home.workspace, "escape.txt"));
  await symlink(join(home.root, "outside-dir"), join(home.workspace, "escape-dir"));
}

/**
 * A second Project with its own tree, plus links inside the first that resolve into it: reading one
 * from the first is the cross-Project escape, and refusing it is what keeps each root honest.
 */
async function writeSecondProject(first: string, second: string): Promise<void> {
  await writeFile(join(second, "README.md"), `${SECOND_README_TEXT}\n`, "utf8");
  await writeFile(join(second, "notes.md"), "second project notes\n", "utf8");
  await symlink(join(second, "notes.md"), join(first, "into-second.txt"));
  await symlink(second, join(first, "into-second"));
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

async function startTwoProjectHarness(): Promise<TwoProjectHarness> {
  const home = await createHermeticHome();
  const secondDirectory = join(home.root, "second-project");
  await mkdir(secondDirectory, { recursive: true });
  await writeWorkspace(home);
  const first = await realpath(home.workspace);
  const second = await realpath(secondDirectory);
  await writeSecondProject(first, second);
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const server = await startServer({
    projects: [first, second],
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
  return { home, first, second, server, client };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  await harness.server.close();
  await harness.home.dispose();
}

async function disposeTwoProjectHarness(harness: TwoProjectHarness): Promise<void> {
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
 * Open a page straight at one Project, with no Session linked. The drawer opens because nothing is
 * open in the transcript; closing it leaves the header reachable.
 */
async function openProjectPage(
  page: Page,
  harness: TwoProjectHarness,
  project: string,
): Promise<void> {
  const params = new URLSearchParams({ project, ws: harness.server.url });
  await page.goto(`${harness.client.url}?${params.toString()}`);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("session-drawer")).toBeVisible();
  await page.getByRole("button", { name: "Close sessions sidebar" }).click();
  await expect(page.getByTestId("session-drawer")).toHaveCount(0);
}

async function switchToProject(page: Page, project: string): Promise<void> {
  await page.getByTestId("sessions-toggle").click();
  await page.getByTestId("project-switch").click();
  await page.locator(`[data-testid="project-row"][data-project="${project}"]`).click();
  await expect(page.getByTestId("session-drawer")).toHaveAttribute("data-level", "sessions");
  await page.getByRole("button", { name: "Close sessions sidebar" }).click();
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

test("the file panel follows the chosen Project, not the open Session", async ({ page }) => {
  const harness = await startTwoProjectHarness();
  try {
    await openProjectPage(page, harness, harness.first);
    await page.getByTestId("files-toggle").click();
    await expect(page.getByTestId("file-tree-root")).toHaveText(harness.first);
    await expect(
      page.getByTestId("file-tree-file").filter({ hasText: "only-in-first.txt" }),
    ).toBeVisible();
    await expect(page.getByTestId("file-tree-file").filter({ hasText: "notes.md" })).toHaveCount(0);

    // The panel named the Project it was opened for, so a switch closes it; reopening asks for the
    // new root and shows only that Project's tree.
    await page.getByTestId("file-tree-close").click();
    await switchToProject(page, harness.second);
    await page.getByTestId("files-toggle").click();
    await expect(page.getByTestId("file-tree-root")).toHaveText(harness.second);
    await expect(page.getByTestId("file-tree-file").filter({ hasText: "notes.md" })).toBeVisible();
    await expect(
      page.getByTestId("file-tree-file").filter({ hasText: "only-in-first.txt" }),
    ).toHaveCount(0);

    // The same relative name is a different file under each root: the preview is this Project's.
    await page.getByRole("button", { name: "Preview README.md" }).click();
    await expect(page.getByTestId("file-preview-text")).toContainText(SECOND_README_TEXT);
    await expect(page.getByTestId("file-preview-text")).not.toContainText(README_TEXT);
  } finally {
    await disposeTwoProjectHarness(harness);
  }
});

test("the folder control waits for a chosen Project", async ({ page }) => {
  const harness = await startTwoProjectHarness();
  try {
    await page.goto(`${harness.client.url}?ws=${encodeURIComponent(harness.server.url)}`);
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    await expect(page.getByTestId("project-picker")).toBeVisible();
    await expect(page.getByTestId("files-toggle")).toBeDisabled();

    await page.locator(`[data-testid="project-row"][data-project="${harness.second}"]`).click();
    await expect(page.getByTestId("files-toggle")).toBeEnabled();
  } finally {
    await disposeTwoProjectHarness(harness);
  }
});

test("listing, preview and download are rooted at the Project each request names", async () => {
  const harness = await startTwoProjectHarness();
  const client = await connectWsSession(harness.server.url);
  const origin = new URL(harness.client.url).origin;
  try {
    client.send({ type: "listDirectory", project: harness.first, path: "" });
    const firstList = await client.next();
    expect(firstList).toMatchObject({
      type: "directoryListing",
      project: harness.first,
      path: "",
    });
    if (firstList.type !== "directoryListing") {
      return;
    }
    const firstNames = firstList.entries.map((listed) => listed.name);
    expect(firstNames).toContain("only-in-first.txt");
    expect(firstNames).not.toContain("notes.md");

    client.send({ type: "listDirectory", project: harness.second, path: "" });
    const secondList = await client.next();
    expect(secondList).toMatchObject({
      type: "directoryListing",
      project: harness.second,
      path: "",
    });
    if (secondList.type !== "directoryListing") {
      return;
    }
    const secondNames = secondList.entries.map((listed) => listed.name);
    expect(secondNames).toContain("notes.md");
    expect(secondNames).not.toContain("only-in-first.txt");

    client.send({ type: "previewFile", project: harness.first, path: "README.md" });
    expect(await client.next()).toMatchObject({
      type: "filePreview",
      project: harness.first,
      path: "README.md",
      text: `${README_TEXT}\n`,
    });

    client.send({ type: "previewFile", project: harness.second, path: "README.md" });
    expect(await client.next()).toMatchObject({
      type: "filePreview",
      project: harness.second,
      path: "README.md",
      text: `${SECOND_README_TEXT}\n`,
    });

    // A name that exists only in the first Project does not resolve anywhere in the second.
    client.send({ type: "previewFile", project: harness.second, path: "only-in-first.txt" });
    expect(await client.next()).toMatchObject({ type: "error", error: { code: "internalError" } });

    expect(
      await download(
        harness.server,
        new URLSearchParams({ project: harness.second, path: "README.md" }).toString(),
        { origin, method: "POST" },
      ),
    ).toEqual({ status: 200, body: `${SECOND_README_TEXT}\n` });

    const missing = await download(
      harness.server,
      new URLSearchParams({ project: harness.second, path: "only-in-first.txt" }).toString(),
      { origin, method: "POST" },
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("only-in-first.txt");
  } finally {
    await client.close();
    await disposeTwoProjectHarness(harness);
  }
});

test("a cross-Project symlink and an unserved Project are both refused", async () => {
  const harness = await startTwoProjectHarness();
  const client = await connectWsSession(harness.server.url);
  const origin = new URL(harness.client.url).origin;
  try {
    // A link inside the first Project that resolves into the second leaves the first's root, which
    // is the whole refusal: the containment check never learns there is a second Project.
    for (const path of ["into-second", "into-second.txt"]) {
      client.send({ type: "listDirectory", project: harness.first, path });
      expect(await client.next()).toMatchObject({
        type: "error",
        error: { code: "pathEscape" },
      });
    }
    for (const path of ["into-second.txt", "into-second/notes.md"]) {
      client.send({ type: "previewFile", project: harness.first, path });
      expect(await client.next()).toMatchObject({
        type: "error",
        error: { code: "pathEscape" },
      });
    }

    const unserved = join(harness.home.root, "not-served");
    client.send({ type: "listDirectory", project: unserved, path: "" });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "unknownProject" },
    });
    client.send({ type: "previewFile", project: unserved, path: "README.md" });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "unknownProject" },
    });
    client.send({ type: "listDirectory", path: "" });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "malformedPayload" },
    });

    // The download route answers an unserved Project like any other security refusal: no body.
    expect(
      await download(
        harness.server,
        new URLSearchParams({ project: unserved, path: "README.md" }).toString(),
        { origin, method: "POST" },
      ),
    ).toEqual({ status: 403, body: "" });
    expect(
      await download(
        harness.server,
        new URLSearchParams({ project: harness.first, path: "into-second.txt" }).toString(),
        { origin, method: "POST" },
      ),
    ).toEqual({ status: 403, body: "" });

    // A request that names no Project says which parameter was missing.
    const unnamed = await download(harness.server, "path=README.md", { origin, method: "POST" });
    expect(unnamed.status).toBe(400);
    expect(unnamed.body).toContain("project");
  } finally {
    await client.close();
    await disposeTwoProjectHarness(harness);
  }
});

test("refuses path traversal, out-of-root reads, and anything that would write", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  const origin = new URL(harness.client.url).origin;
  const query = (path: string): string =>
    new URLSearchParams({ project: harness.project, path }).toString();
  try {
    client.send({
      type: "subscribe",
      session: { project: harness.project, id: harness.seeded.id },
    });
    expect((await client.next()).type).toBe("snapshot");
    // Settings and the discoverable commands follow the Snapshot, so consume both before asserting
    // on capability replies.
    await readAttachSurfaces(client);

    // Traversal, an absolute path and a symlink escape are each a typed refusal, never a listing.
    for (const path of ["..", "/etc", "escape-dir"]) {
      client.send({ type: "listDirectory", project: harness.project, path });
      expect(await client.next()).toMatchObject({
        type: "error",
        error: { code: "pathEscape" },
      });
    }

    // A preview of a file outside the root is refused the same way.
    client.send({ type: "previewFile", project: harness.project, path: "escape.txt" });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "pathEscape" },
    });

    // The download route refuses the same paths, and a foreign origin, without leaking a body.
    const post = { origin, method: "POST" } as const;
    expect(await download(harness.server, query("../outside.txt"), post)).toEqual({
      status: 403,
      body: "",
    });
    expect(await download(harness.server, query("/etc/passwd"), post)).toEqual({
      status: 403,
      body: "",
    });
    expect(
      await download(harness.server, query("README.md"), { ...post, method: "GET" }),
    ).toMatchObject({ status: 405 });
    expect(
      await download(harness.server, query("README.md"), {
        origin: "http://evil.example",
        method: "POST",
      }),
    ).toEqual({ status: 403, body: "" });

    // No message can write: an edit-shaped message is an unknown type, and a request with no path is
    // malformed rather than defaulted.
    client.send({ type: "writeFile", project: harness.project, path: "README.md", text: "x" });
    expect(await client.next()).toMatchObject({ type: "error", error: { code: "unknownType" } });
    client.send({ type: "listDirectory", project: harness.project });
    expect(await client.next()).toMatchObject({
      type: "error",
      error: { code: "malformedPayload" },
    });
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

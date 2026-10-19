import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch } from "../src/pi-harness";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const VITE_BIN = join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
const CLIENT_DIR = join(REPO_ROOT, "packages", "client");

/** The seeded Session asks the model nothing; pi still resolves this script as its only model. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

async function waitForDevServer(
  url: string,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`vite exited ${String(child.exitCode)} before serving: ${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`vite never served ${url}: ${output()}`);
}

test("the dev server reaches real pi from a browser through the proxy", async ({ page }) => {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  let server: RunningServer | undefined;
  let vite: ChildProcess | undefined;
  let viteOutput = "";

  try {
    server = await startServer({
      projects: [launch.cwd],
      sessionDir: home.sessionsDir,
      port: home.ports.allocate(),
      pi: {
        args: launch.args,
        env: launch.env,
        provider: launch.provider,
        model: launch.model,
      },
    });

    const vitePort = home.ports.allocate();
    vite = spawn(
      process.execPath,
      [VITE_BIN, "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"],
      {
        cwd: CLIENT_DIR,
        env: { ...process.env, PI_MY_UI_BACKEND_ORIGIN: server.httpUrl },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    vite.stdout?.on("data", (chunk: Buffer) => {
      viteOutput += chunk.toString();
    });
    vite.stderr?.on("data", (chunk: Buffer) => {
      viteOutput += chunk.toString();
    });

    const devUrl = `http://127.0.0.1:${String(vitePort)}/`;
    await waitForDevServer(devUrl, vite, () => viteOutput);

    await page.goto(`${devUrl}?session=${encodeURIComponent(seeded.id)}`);
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    await expect(page.getByTestId("transcript")).toContainText("Seed text block 3.");
  } finally {
    vite?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (vite === undefined || vite.exitCode !== null) {
        resolve();
        return;
      }
      vite.once("exit", () => resolve());
    });
    await server?.close().catch(() => undefined);
    await home.dispose();
  }
});

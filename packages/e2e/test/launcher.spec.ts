import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import {
  LOG_PREFIX,
  runLauncher,
  startServer,
  type LauncherIo,
  type LauncherSignals,
  type RunningServer,
} from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";
import { WebSocket } from "ws";

import { seedSession } from "../src/fixture-builder";
import { createHermeticHome, createPortNamespace, scriptedPiLaunch } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";

const PI_TEST_TIMEOUT_MS = 90_000;
test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const CLI_PATH = fileURLToPath(new URL("../../server/dist/cli.js", import.meta.url));

/** The flags `--help` must name; a flagship without a line here is undiscoverable. */
const DOCUMENTED_FLAGS = [
  "--project",
  "--port",
  "--host",
  "--idle-timeout",
  "--keep-alive",
  "--allowed-origin",
  "--help",
] as const;

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

function occupiedPort(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const holder = createServer();
    holder.once("error", reject);
    holder.listen(0, "127.0.0.1", () => {
      const address = holder.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the port holder did not bind a TCP address"));
        return;
      }
      resolve({
        port: address.port,
        release: () =>
          new Promise<void>((done) => {
            holder.close(() => done());
          }),
      });
    });
  });
}

async function waitForHealth(
  url: string,
  child: ChildProcess,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `the launcher exited ${String(child.exitCode)} before listening: ${stderr()}`,
      );
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
  throw new Error(`the launcher never answered ${url}: ${stderr()}`);
}

/** Resolve `true` when the upgrade is accepted; `false` when the server refuses it. */
function upgradeAccepted(url: string, origin: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, origin === undefined ? {} : { headers: { origin } });
    socket.on("open", () => {
      socket.close();
      resolve(true);
    });
    const refused = (): void => {
      resolve(false);
    };
    socket.on("error", refused);
    socket.on("unexpected-response", refused);
  });
}

/** The `pi` children of this worker; pi sets its process title to `pi`, so the argv is the marker. */
function ownPiChildPids(): number[] {
  const output = execFileSync("ps", ["-eww", "-o", "pid=,ppid=,args="], { encoding: "utf8" });
  const pids: number[] = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[0] ?? "", 10);
    const ppid = Number.parseInt(parts[1] ?? "", 10);
    const command = parts.slice(2).join(" ");
    if (ppid === process.pid && command === "pi" && Number.isInteger(pid)) {
      pids.push(pid);
    }
  }
  return pids;
}

function signalSource(): { source: LauncherSignals; emit(signal: NodeJS.Signals): void } {
  const listeners = new Map<NodeJS.Signals, Set<() => void>>();
  return {
    source: {
      on(signal, listener) {
        const set = listeners.get(signal) ?? new Set();
        set.add(listener);
        listeners.set(signal, set);
      },
      off(signal, listener) {
        listeners.get(signal)?.delete(listener);
      },
    },
    emit(signal) {
      for (const listener of listeners.get(signal) ?? []) {
        listener();
      }
    },
  };
}

const SILENT_IO: LauncherIo = { out: () => undefined, err: () => undefined };

test("--help lists every flag", () => {
  const result = spawnSync("node", [CLI_PATH, "--help"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  for (const flag of DOCUMENTED_FLAGS) {
    expect(result.stdout).toContain(flag);
  }
});

test("a taken port fails with one line naming --port", async () => {
  const taken = await occupiedPort();
  try {
    const result = spawnSync("node", [CLI_PATH, "--port", String(taken.port)], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--port");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
  } finally {
    await taken.release();
  }
});

test("health answers and the server serves no pages", async () => {
  const home = await createHermeticHome();
  const port = home.ports.allocate();
  const child = spawn("node", [CLI_PATH, "--port", String(port)], {
    cwd: home.workspace,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHealth(`http://127.0.0.1:${String(port)}/healthz`, child, () => stderr);

    const listening = `http://127.0.0.1:${String(port)}`;
    await expect.poll(() => stdout.includes(listening)).toBe(true);
    expect(stdout).toContain(`project ${realpathSync(home.workspace)}`);

    const health = await fetch(`${listening}/healthz`);
    expect(await health.json()).toEqual({ status: "ok", service: "pi-my-ui-server" });
    for (const path of ["/", "/index.html", "/assets/app.js"]) {
      const response = await fetch(`${listening}${path}`);
      expect(response.status).toBe(404);
    }
  } finally {
    child.kill("SIGINT");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    await home.dispose();
  }
});

/** The Projects a launcher named on stdout, in the order it printed them. */
function projectBannerLines(stdout: string): string[] {
  const prefix = `${LOG_PREFIX} project `;
  return stdout
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

test("--project is repeatable and the banner names every Project in order", async () => {
  const home = await createHermeticHome();
  const second = join(home.root, "second-project");
  mkdirSync(second);
  const port = home.ports.allocate();
  const child = spawn(
    "node",
    [CLI_PATH, "--project", home.workspace, "--project", second, "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHealth(`http://127.0.0.1:${String(port)}/healthz`, child, () => stderr);
    await expect.poll(() => projectBannerLines(stdout)).toHaveLength(2);
    expect(projectBannerLines(stdout)).toEqual([
      realpathSync(home.workspace),
      realpathSync(second),
    ]);
  } finally {
    child.kill("SIGINT");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    await home.dispose();
  }
});

/** Run the launcher with arguments that must be refused, and return what it printed. */
function refusedStartup(argv: readonly string[]): string {
  const result = spawnSync("node", [CLI_PATH, ...argv], { encoding: "utf8", timeout: 20_000 });
  expect(result.status).not.toBe(0);
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  return result.stderr;
}

test("a --project that does not exist refuses startup and names it", async () => {
  const home = await createHermeticHome();
  try {
    const missing = join(realpathSync(home.root), "not-there");
    const stderr = refusedStartup(["--project", missing]);
    expect(stderr).toContain("--project");
    expect(stderr).toContain(missing);
  } finally {
    await home.dispose();
  }
});

test("a --project that is a file refuses startup and names it", async () => {
  const home = await createHermeticHome();
  try {
    const file = join(realpathSync(home.root), "not-a-directory.txt");
    writeFileSync(file, "a file, not a folder\n");
    const stderr = refusedStartup(["--project", file]);
    expect(stderr).toContain("--project");
    expect(stderr).toContain(file);
  } finally {
    await home.dispose();
  }
});

test("two spellings of one Project are refused after resolution", async () => {
  const home = await createHermeticHome();
  try {
    const link = join(home.root, "workspace-link");
    symlinkSync(home.workspace, link);
    const stderr = refusedStartup(["--project", home.workspace, "--project", link]);
    expect(stderr).toContain("--project");
    expect(stderr).toContain(realpathSync(home.workspace));
  } finally {
    await home.dispose();
  }
});

test("a Project nested inside another served Project is refused naming both", async () => {
  const home = await createHermeticHome();
  try {
    const nested = join(home.workspace, "packages");
    mkdirSync(nested);
    const stderr = refusedStartup(["--project", home.workspace, "--project", nested]);
    expect(stderr).toContain("--project");
    expect(stderr).toContain(realpathSync(home.workspace));
    expect(stderr).toContain(realpathSync(nested));
  } finally {
    await home.dispose();
  }
});

test("--cwd is not an alias for --project", () => {
  const result = spawnSync("node", [CLI_PATH, "--cwd", "."], { encoding: "utf8", timeout: 20_000 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("unknown flag --cwd");
});

test("--help describes --project as repeatable", () => {
  const result = spawnSync("node", [CLI_PATH, "--help"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("--project <dir>");
  expect(result.stdout).toContain("repeatable");
  expect(result.stdout).not.toContain("--cwd");
});

test("a foreign or missing origin is refused and logged", async () => {
  const ports = await createPortNamespace();
  const logLines: string[] = [];
  const server = await startServer({
    projects: [process.cwd()],
    host: "127.0.0.1",
    port: ports.allocate(),
    allowedOrigins: ["http://allowed.example"],
    log: (line) => logLines.push(line),
  });
  try {
    expect(await upgradeAccepted(server.url, "http://allowed.example")).toBe(true);
    expect(await upgradeAccepted(server.url, "http://evil.example")).toBe(false);
    expect(await upgradeAccepted(server.url, undefined)).toBe(false);
    expect(logLines.some((line) => line.includes("http://evil.example"))).toBe(true);
  } finally {
    await server.close();
  }
});

test("SIGINT shuts down cleanly and stops the Pi children across every Project", async () => {
  const home = await createHermeticHome();
  const secondDirectory = join(home.root, "second-project");
  mkdirSync(secondDirectory, { recursive: true });
  const second = realpathSync(secondDirectory);
  const seeded = await seedSession(home, "plain");
  const seededSecond = await seedSession(home, "branching", { project: second });
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const signals = signalSource();
  let running: RunningServer | undefined;

  try {
    const run = runLauncher({
      argv: [
        "--port",
        String(home.ports.allocate()),
        "--project",
        home.workspace,
        "--project",
        second,
      ],
      processCwd: home.workspace,
      io: SILENT_IO,
      signals: signals.source,
      startServer: async (config) => {
        running = await startServer({
          ...config,
          sessionDir: home.sessionsDir,
          pi: {
            args: launch.args,
            env: launch.env,
            provider: launch.provider,
            model: launch.model,
          },
        });
        return running;
      },
    });

    await expect.poll(() => running?.port ?? 0).toBeGreaterThan(0);
    const server = running;
    if (server === undefined) {
      throw new Error("the launcher never started a server");
    }

    const first = await connectWsSession(server.url);
    first.send({ type: "subscribe", session: { project: home.workspace, id: seeded.id } });
    expect((await first.next()).type).toBe("snapshot");

    const secondClient = await connectWsSession(server.url);
    secondClient.send({ type: "subscribe", session: { project: second, id: seededSecond.id } });
    expect((await secondClient.next()).type).toBe("snapshot");
    await first.close();
    await secondClient.close();

    // One process seated a child in each Project, and one signal has to reclaim both.
    await expect.poll(() => ownPiChildPids().length).toBe(2);

    signals.emit("SIGINT");
    expect(await run).toBe(0);
    await expect.poll(() => ownPiChildPids().length).toBe(0);
  } finally {
    await running?.close().catch(() => undefined);
    await home.dispose();
  }
});

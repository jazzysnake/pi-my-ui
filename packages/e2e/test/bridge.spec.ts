import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "@playwright/test";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import type { Script } from "@pi-my-ui/scripted-provider";

import { seedSession, type FixtureSession } from "../src/fixture-builder";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession } from "../src/ws-session-client";

const PI_TEST_TIMEOUT_MS = 90_000;
test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "a prompt this recording never saw" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

/** The file mode every level of the bridge socket's path must limit to the owner. */
const USER_ONLY_DIRECTORY_MODE = 0o700;
const USER_ONLY_SOCKET_MODE = 0o600;

async function createBridgeDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "pi-my-ui-bridge-"));
}

function modeOf(path: string): Promise<number> {
  return stat(path).then((stats) => stats.mode & 0o777);
}

/** A socket listener owning `path`, standing in for whatever else might hold it. */
async function listenOn(path: string): Promise<{ close: () => Promise<void> }> {
  await mkdir(dirname(path), { recursive: true });
  const server = createNetServer();
  await new Promise<void>((resolve) => {
    server.listen(path, resolve);
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

test("the bridge socket and its directory are user-only", async () => {
  const dir = await createBridgeDir();
  const socketPath = join(dir, "run", "bridge.sock");
  let server: RunningServer | undefined;
  try {
    server = await startServer({ cwd: process.cwd(), port: 0, bridge: { socketPath } });

    expect(await modeOf(dirname(socketPath))).toBe(USER_ONLY_DIRECTORY_MODE);
    expect((await stat(socketPath)).isSocket()).toBe(true);
    expect(await modeOf(socketPath)).toBe(USER_ONLY_SOCKET_MODE);
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a stale socket left by a crash is replaced", async () => {
  const dir = await createBridgeDir();
  const socketPath = join(dir, "run", "bridge.sock");
  await mkdir(dirname(socketPath), { recursive: true });
  // A file the path still names but nothing listens on: exactly what a server killed before it could
  // clean up leaves behind.
  await writeFile(socketPath, "", "utf8");
  let server: RunningServer | undefined;
  try {
    server = await startServer({ cwd: process.cwd(), port: 0, bridge: { socketPath } });
    expect((await stat(socketPath)).isSocket()).toBe(true);
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a socket a live server already owns is refused loudly", async () => {
  const dir = await createBridgeDir();
  const socketPath = join(dir, "run", "bridge.sock");
  const live = await listenOn(socketPath);
  try {
    await expect(
      startServer({ cwd: process.cwd(), port: 0, bridge: { socketPath } }),
    ).rejects.toThrow(/already listening/);
  } finally {
    await live.close();
    await rm(dir, { recursive: true, force: true });
  }
});

interface BridgeHarness {
  readonly home: HermeticHome;
  readonly seeded: FixtureSession;
  readonly server: RunningServer;
  readonly logs: readonly string[];
}

interface BridgeLaunchOverrides {
  readonly extensionEntry?: string;
  readonly socketPath: string;
  readonly connectTimeoutMs?: number;
}

async function startBridgeHarness(
  bridge: BridgeLaunchOverrides,
  options: { readonly captureLogs?: boolean } = {},
): Promise<BridgeHarness> {
  const home = await createHermeticHome();
  const seeded = await seedSession(home, "plain");
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const logs: string[] = [];
  const server = await startServer({
    cwd: launch.cwd,
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    ...(options.captureLogs === true ? { log: (line: string) => logs.push(line) } : {}),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
    bridge,
  });
  return { home, seeded, server, logs };
}

/** Subscribe to the seeded Session and assert the server reports the bridge, not a Projection. */
async function expectSubscribeBridgeFailure(harness: BridgeHarness): Promise<void> {
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({ type: "subscribe", sessionId: harness.seeded.id });
    const message = await client.next(20_000);
    expect(message.type).toBe("error");
    if (message.type === "error") {
      expect(message.error.message).toMatch(/bridge/i);
    }
    expect(harness.logs.some((line) => /bridge/i.test(line))).toBe(true);
  } finally {
    await client.close();
  }
}

test("a Session whose Pi child never connects its bridge fails loudly", async () => {
  const dir = await createBridgeDir();
  const noOpExtension = join(dir, "no-op-extension.mjs");
  await writeFile(noOpExtension, "export default function register() {}\n", "utf8");
  const harness = await startBridgeHarness(
    {
      extensionEntry: noOpExtension,
      socketPath: join(dir, "bridge.sock"),
      connectTimeoutMs: 3_000,
    },
    { captureLogs: true },
  );
  try {
    await expectSubscribeBridgeFailure(harness);
  } finally {
    await harness.server.close();
    await harness.home.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a Session whose bridge extension cannot be loaded fails loudly", async () => {
  const dir = await createBridgeDir();
  const harness = await startBridgeHarness(
    { extensionEntry: join(dir, "missing-extension.mjs"), socketPath: join(dir, "bridge.sock") },
    { captureLogs: true },
  );
  try {
    await expectSubscribeBridgeFailure(harness);
  } finally {
    await harness.server.close();
    await harness.home.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a Session is served with the real bridge and the socket path never reaches the browser", async () => {
  const dir = await createBridgeDir();
  const socketPath = join(dir, "bridge.sock");
  const harness = await startBridgeHarness({ socketPath });
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({ type: "subscribe", sessionId: harness.seeded.id });
    const snapshot = await client.next();

    expect(snapshot.type).toBe("snapshot");
    if (snapshot.type === "snapshot") {
      expect(snapshot.projection.sessionId).toBe(harness.seeded.id);
    }
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain(socketPath);
    expect(text).not.toContain("PI_MY_UI_BRIDGE_SOCKET");
  } finally {
    await client.close();
    await harness.server.close();
    await harness.home.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SessionEntry, SessionTreeNode } from "@earendil-works/pi-coding-agent";
import { expect, test } from "@playwright/test";
import type { Script } from "@pi-my-ui/scripted-provider";

import {
  SEED_NAMES,
  generateSession,
  seedSession,
  type FixtureSession,
  type SeedName,
} from "../src/fixture-builder";
import { createHermeticHome, startScriptedPi, type HermeticHome } from "../src/pi-harness";

const PI_TEST_TIMEOUT_MS = 120_000;
test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

const SEEDS_DIR = fileURLToPath(new URL("../fixtures/seeds/", import.meta.url));
const ALLOW_LIST = fileURLToPath(new URL("../fixtures/seeds.json", import.meta.url));
const FIXTURE_CHECK = fileURLToPath(new URL("../../../scripts/fixture-check.mjs", import.meta.url));

/** A seed the checkout has already committed must stay comfortably inside this bound. */
const COMMITTED_SEED_BYTE_LIMIT = 64 * 1024;

/** Never invoked: these tests open a Session, they do not run a turn. */
const UNUSED_SCRIPT: Script = [
  {
    expect: { role: "user", text: "unused" },
    reply: { content: [{ type: "text", text: "unused" }], stopReason: "stop" },
  },
];

function flatten(nodes: readonly SessionTreeNode[], found: SessionEntry[] = []): SessionEntry[] {
  for (const node of nodes) {
    found.push(node.entry);
    flatten(node.children, found);
  }
  return found;
}

function maxDepth(nodes: readonly SessionTreeNode[], depth = 1): number {
  let deepest = depth;
  for (const node of nodes) {
    deepest = Math.max(deepest, maxDepth(node.children, depth + 1));
  }
  return deepest;
}

interface LoadedSession {
  readonly entries: readonly SessionEntry[];
  readonly tree: readonly SessionTreeNode[];
  readonly leafId: string | null;
  readonly sessionId: string;
}

/**
 * Open a seeded file through real pi's RPC. Opening is the whole test: pi's own loader rejects a
 * malformed tree, so a returned tree is evidence the fixture is a session pi accepts.
 */
async function openInRealPi(home: HermeticHome, session: FixtureSession): Promise<LoadedSession> {
  const pi = await startScriptedPi({ home, script: UNUSED_SCRIPT });
  try {
    await pi.child.switchSession(session.path);
    const state = await pi.child.getState();
    const { tree, leafId } = await pi.child.getTree();
    return { entries: flatten(tree), tree, leafId, sessionId: state.sessionId };
  } finally {
    await pi.stop();
  }
}

function hasBranch(tree: readonly SessionTreeNode[]): boolean {
  for (const node of tree) {
    if (node.children.length > 1 || hasBranch(node.children)) {
      return true;
    }
  }
  return false;
}

test("every curated seed loads in real pi and carries the shape its name promises", async () => {
  const home = await createHermeticHome();
  try {
    for (const name of SEED_NAMES) {
      const seeded = await seedSession(home, name);
      const loaded = await openInRealPi(home, seeded);

      expect(loaded.sessionId, name).toBe(seeded.id);
      // Resuming a Session lets pi append its own setup entry (a thinking-level change), so the
      // loaded tree is the seed plus pi's additions; the seed's own entries must all be there.
      expect(loaded.entries.length, name).toBeGreaterThanOrEqual(seeded.entryCount);
      expect(
        loaded.entries.some((entry) => entry.id === seeded.leafId),
        name,
      ).toBe(true);

      const shape = SEED_SHAPES[name];
      if (shape === undefined) {
        throw new Error(`no shape expectation for seed ${name}`);
      }
      expect(hasBranch(loaded.tree), `${name}: branch shape`).toBe(shape.branches);
      expect(
        loaded.entries.some((entry) => entry.type === "compaction"),
        `${name}: compaction shape`,
      ).toBe(shape.compaction);
      expect(loaded.entries.length, `${name}: size`).toBeGreaterThanOrEqual(shape.minEntries);
      if (shape.minSubagentRecords > 0) {
        const records = loaded.entries.filter(
          (entry) => entry.type === "custom" && entry.customType === "subagents:record",
        );
        expect(records.length, `${name}: subagent records`).toBeGreaterThanOrEqual(
          shape.minSubagentRecords,
        );
      }
    }
  } finally {
    await home.dispose();
  }
});

interface SeedShape {
  readonly branches: boolean;
  readonly compaction: boolean;
  readonly minEntries: number;
  readonly minSubagentRecords: number;
}

const SEED_SHAPES: Record<SeedName, SeedShape> = {
  plain: { branches: false, compaction: false, minEntries: 10, minSubagentRecords: 0 },
  branching: { branches: true, compaction: false, minEntries: 10, minSubagentRecords: 0 },
  compaction: { branches: false, compaction: true, minEntries: 20, minSubagentRecords: 0 },
  subagents: { branches: false, compaction: false, minEntries: 40, minSubagentRecords: 5 },
  large: { branches: false, compaction: false, minEntries: 100, minSubagentRecords: 0 },
};

test("the generator makes a 500+ entry transcript that real pi loads", async () => {
  const home = await createHermeticHome();
  try {
    const generated = await generateSession(home, "transcript");
    expect(generated.entryCount).toBeGreaterThanOrEqual(500);

    const loaded = await openInRealPi(home, generated);
    expect(loaded.sessionId).toBe(generated.id);
    expect(loaded.entries.length).toBeGreaterThanOrEqual(generated.entryCount);
    expect(loaded.entries.some((entry) => entry.id === generated.leafId)).toBe(true);
  } finally {
    await home.dispose();
  }
});

test("the generator makes a 100-deep tree that real pi loads", async () => {
  const home = await createHermeticHome();
  try {
    const generated = await generateSession(home, "deep-tree");
    const loaded = await openInRealPi(home, generated);

    expect(loaded.entries.length).toBeGreaterThanOrEqual(generated.entryCount);
    expect(maxDepth(loaded.tree)).toBeGreaterThanOrEqual(100);
    expect(hasBranch(loaded.tree)).toBe(true);
  } finally {
    await home.dispose();
  }
});

test("the generator makes a subagent-heavy session that real pi loads", async () => {
  const home = await createHermeticHome();
  try {
    const generated = await generateSession(home, "subagents");
    const loaded = await openInRealPi(home, generated);

    const subagentRecords = loaded.entries.filter(
      (entry) => entry.type === "custom" && entry.customType === "subagents:record",
    );
    expect(subagentRecords.length).toBeGreaterThanOrEqual(50);
  } finally {
    await home.dispose();
  }
});

test("the committed seeds are small, valid and free of personal content", async () => {
  const names = (await readdir(SEEDS_DIR)).filter((name) => name.endsWith(".jsonl")).sort();
  expect(names).toEqual([...SEED_NAMES].sort().map((name) => `${name}.jsonl`));

  // The allowlist is what the fixture check reads; keeping it equal to SEED_NAMES stops the two
  // from drifting into a curated file the check would reject.
  const allowList: unknown = JSON.parse(await readFile(ALLOW_LIST, "utf8"));
  expect(allowList).toEqual([...SEED_NAMES]);

  for (const name of names) {
    const text = await readFile(join(SEEDS_DIR, name), "utf8");
    expect(Buffer.byteLength(text), `${name}: size`).toBeLessThan(COMMITTED_SEED_BYTE_LIMIT);

    const firstLine = text.trim().split("\n")[0] ?? "";
    expect(JSON.parse(firstLine).type, `${name}: header`).toBe("session");

    for (const personal of ["/home/", "/Users/", "/root/", "matee", "ges2t"]) {
      expect(text.toLowerCase(), `${name}: ${personal}`).not.toContain(personal.toLowerCase());
    }
  }
});

function sessionFileText(id: string, messages: number): string {
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2030-01-01T00:00:00.000Z",
      cwd: "/tmp/fixture-check-workspace",
    }),
  ];
  let parentId: string | null = null;
  for (let index = 0; index < messages; index += 1) {
    const entryId = `e${String(index).padStart(7, "0")}`;
    lines.push(
      JSON.stringify({
        type: "message",
        id: entryId,
        parentId,
        timestamp: "2030-01-01T00:00:01.000Z",
        message: { role: "user", content: "hello", timestamp: 1893456001000 },
      }),
    );
    parentId = entryId;
  }
  return `${lines.join("\n")}\n`;
}

function runFixtureCheck(
  root: string,
  seedsDir: string,
  allow: string,
  maxBytes: number,
): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      FIXTURE_CHECK,
      "--root",
      root,
      "--seeds-dir",
      seedsDir,
      "--allow",
      allow,
      "--max-bytes",
      String(maxBytes),
    ],
    { encoding: "utf8" },
  );
}

test("the fixture check rejects a staged raw session and an oversized seed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-my-ui-fixture-check-"));
  const seedsDir = join(root, "packages", "e2e", "fixtures", "seeds");
  const allow = join(root, "packages", "e2e", "fixtures", "seeds.json");
  await mkdir(seedsDir, { recursive: true });
  await writeFile(allow, JSON.stringify(["plain"]));

  try {
    spawnSync("git", ["init", "-q", root], { encoding: "utf8" });

    // A session file outside the curated seeds directory is raw by definition.
    await writeFile(join(root, "raw.jsonl"), sessionFileText("aaaa1111", 2));
    spawnSync("git", ["-C", root, "add", "raw.jsonl"], { encoding: "utf8" });
    const raw = runFixtureCheck(root, seedsDir, allow, 1024 * 1024);
    expect(raw.status).toBe(1);
    expect(`${raw.stdout}${raw.stderr}`).toMatch(/raw/i);

    await rm(join(root, "raw.jsonl"), { force: true });
    spawnSync("git", ["-C", root, "add", "-A"], { encoding: "utf8" });
    await writeFile(join(seedsDir, "plain.jsonl"), sessionFileText("bbbb2222", 40));
    spawnSync("git", ["-C", root, "add", "packages"], { encoding: "utf8" });

    const oversized = runFixtureCheck(root, seedsDir, allow, 200);
    expect(oversized.status).toBe(1);
    expect(`${oversized.stdout}${oversized.stderr}`).toMatch(/oversized/i);

    const accepted = runFixtureCheck(root, seedsDir, allow, 1024 * 1024);
    expect(accepted.status, `${accepted.stdout}${accepted.stderr}`).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

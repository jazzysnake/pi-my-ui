#!/usr/bin/env node
// The end-to-end gate: run the whole suite as a fixed number of shards, concurrently, and fail
// unless every shard passed and every test in the suite is accounted for.
//
// Sharding buys wall-clock only when one Playwright process's workers leave cores idle, so this is
// for the suite as it grows past what a single process can use. Its other job is honesty: a shard
// process that dies before running its tests would otherwise vanish from the total, so the gate
// reconciles what ran against a discovery run of the same configuration and refuses a mismatch.
//
// Each shard is a separate process, so its tests' OS-assigned port namespaces are disjoint from
// every other shard's (see `createPortNamespace` in packages/e2e/src/pi-harness.ts): the kernel
// never hands two live probes the same port.
//
// Usage: node scripts/test-e2e-sharded.mjs [--shards N]

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(REPO_ROOT, "packages", "e2e", "playwright.config.ts");
const PLAYWRIGHT_BIN = join(
  REPO_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);

/**
 * Each shard spawns its own workers, so the count must stay low enough that the shards' workers fit
 * the machine's cores. More shards than that oversubscribes the box and slows the timing-sensitive
 * streaming specs, which is why two is the default rather than one per spec file.
 */
const DEFAULT_SHARDS = 2;
const SHARDS_ENV_VAR = "PI_MY_UI_E2E_SHARDS";
/** The product promise for the whole run, so a run above it fails the gate rather than warning. */
const WALL_BUDGET_MS = 60_000;

class E2eShardError extends Error {
  constructor(message) {
    super(message);
    this.name = "E2eShardError";
  }
}

function parseShardCount(argv) {
  const flagIndex = argv.indexOf("--shards");
  if (flagIndex !== -1 && argv[flagIndex + 1] === undefined) {
    throw new E2eShardError("--shards needs a value");
  }
  const raw = flagIndex === -1 ? process.env[SHARDS_ENV_VAR] : argv[flagIndex + 1];
  if (raw === undefined || raw === "") {
    return DEFAULT_SHARDS;
  }
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    throw new E2eShardError(`--shards must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return count;
}

/** The `list :: project :: title` key of one spec, the unit the gate accounts for. */
function specKeys(suite, found = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      found.push(`${spec.file} :: ${test.projectName} :: ${spec.title}`);
    }
  }
  for (const child of suite.suites ?? []) {
    specKeys(child, found);
  }
  return found;
}

function parseReport(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new E2eShardError(
      `${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collectFromReport(report, source) {
  const keys = [];
  for (const suite of report.suites ?? []) {
    keys.push(...specKeys(suite));
  }
  if (keys.length === 0) {
    throw new E2eShardError(`${source} reported no tests`);
  }
  return keys;
}

/**
 * Run Playwright. A shard inherits stdio so its list reporter and failures reach the terminal live;
 * the discovery run captures stdout because its JSON is the payload.
 */
function runPlaywright(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(PLAYWRIGHT_BIN, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...options.env },
      stdio: options.capture === true ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (options.capture === true) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.on("error", rejectRun);
    child.on("close", (code, signal) => {
      resolveRun({ code, signal, stdout });
    });
  });
}

/** Every test the configuration would run, collected without a browser or a build. */
async function discoverSuite() {
  const result = await runPlaywright(
    ["test", "--config", CONFIG_PATH, "--list", "--reporter=json"],
    { capture: true },
  );
  if (result.code !== 0) {
    throw new E2eShardError(
      `the discovery run exited ${result.code ?? `on ${result.signal ?? "a signal"}`}`,
    );
  }
  return collectFromReport(parseReport(result.stdout, "the discovery run"), "the discovery run");
}

async function runShard(index, total, reportDir) {
  const reportPath = join(reportDir, `shard-${String(index)}.json`);
  const result = await runPlaywright(
    [
      "test",
      "--config",
      CONFIG_PATH,
      `--shard=${String(index)}/${String(total)}`,
      "--reporter=list,json",
    ],
    { env: { PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath } },
  );
  return { index, ...result, reportPath };
}

/** Read one shard's report and its executed/expected keys, or throw with the reason it cannot. */
async function readShardReport(shard) {
  let text;
  try {
    text = await readFile(shard.reportPath, "utf8");
  } catch {
    throw new E2eShardError(
      `shard ${String(shard.index)} wrote no report (exit ${shard.code ?? shard.signal ?? "unknown"})`,
    );
  }
  const report = parseReport(text, `shard ${String(shard.index)}'s report`);
  const stats = report.stats ?? {};
  return {
    index: shard.index,
    code: shard.code,
    signal: shard.signal,
    keys: collectFromReport(report, `shard ${String(shard.index)}`),
    passed: stats.expected ?? 0,
    failed: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    skipped: stats.skipped ?? 0,
  };
}

function reconcile(shards, expected) {
  const expectedSet = new Set(expected);
  const seen = new Map();
  const problems = [];

  for (const shard of shards) {
    if (shard.code !== 0) {
      problems.push(`shard ${String(shard.index)} failed (exit ${shard.code ?? shard.signal})`);
    }
    for (const key of shard.keys) {
      const previous = seen.get(key);
      if (previous !== undefined) {
        problems.push(`"${key}" ran in shards ${String(previous)} and ${String(shard.index)}`);
      } else {
        seen.set(key, shard.index);
      }
    }
  }

  for (const key of expectedSet) {
    if (!seen.has(key)) {
      problems.push(`"${key}" ran in no shard`);
    }
  }
  for (const key of seen.keys()) {
    if (!expectedSet.has(key)) {
      problems.push(`"${key}" is not in the discovered suite`);
    }
  }
  return problems;
}

function reportSummary(shards, expectedCount, elapsedMs) {
  for (const shard of shards) {
    console.log(
      `[e2e-shards] shard ${String(shard.index)}: ${String(shard.keys.length)} test(s) ` +
        `(${String(shard.passed)} passed, ${String(shard.failed)} failed, ` +
        `${String(shard.flaky)} flaky, ${String(shard.skipped)} skipped)`,
    );
  }
  const ran = shards.reduce((total, shard) => total + shard.keys.length, 0);
  console.log(
    `[e2e-shards] accounted for ${String(ran)}/${String(expectedCount)} test(s) ` +
      `across ${String(shards.length)} shard(s) in ${String(elapsedMs)}ms ` +
      `(budget ${String(WALL_BUDGET_MS)}ms)`,
  );
  if (elapsedMs > WALL_BUDGET_MS) {
    console.warn(
      `[e2e-shards] OVER BUDGET by ${String(elapsedMs - WALL_BUDGET_MS)}ms; ` +
        "re-balance the shards or the suite has outgrown them",
    );
  }
}

async function main() {
  const shardCount = parseShardCount(process.argv.slice(2));
  const startedAt = Date.now();
  const reportDir = await mkdtemp(join(tmpdir(), "pi-my-ui-shards-"));

  try {
    const expected = await discoverSuite();
    console.log(
      `[e2e-shards] discovered ${String(expected.length)} test(s); ` +
        `running ${String(shardCount)} shard(s)`,
    );

    const results = await Promise.all(
      Array.from({ length: shardCount }, (_, offset) =>
        runShard(offset + 1, shardCount, reportDir),
      ),
    );

    const shards = [];
    for (const result of results) {
      shards.push(await readShardReport(result));
    }

    const elapsedMs = Date.now() - startedAt;
    reportSummary(shards, expected.length, elapsedMs);

    const problems = reconcile(shards, expected);
    if (problems.length > 0) {
      throw new E2eShardError(`the gate is not green:\n  - ${problems.join("\n  - ")}`);
    }
    if (elapsedMs > WALL_BUDGET_MS) {
      throw new E2eShardError(
        `the run took ${String(elapsedMs)}ms, over the ${String(WALL_BUDGET_MS)}ms budget`,
      );
    }
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }

  console.log(`[e2e-shards] PASSED - every shard green and every test accounted for.`);
}

try {
  await main();
} catch (error) {
  console.error(`[e2e-shards] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

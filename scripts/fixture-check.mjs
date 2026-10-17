#!/usr/bin/env node
// Refuse to commit a raw or oversized pi Session file.
//
// Curated seeds live under `packages/e2e/fixtures/seeds` and are derived and sanitised there; any
// other staged `*.jsonl` that parses as a Session is an unedited copy of somebody's real history,
// and a Session file over the size bound is not a seed either. The seeds directory itself is
// checked on every run, because a file committed in an earlier change is never staged again.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MAX_BYTES = 128 * 1024;

function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    seedsDir: join(REPO_ROOT, "packages", "e2e", "fixtures", "seeds"),
    allow: join(REPO_ROOT, "packages", "e2e", "fixtures", "seeds.json"),
    maxBytes: DEFAULT_MAX_BYTES,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--root" && value !== undefined) {
      options.root = resolve(value);
    } else if (flag === "--seeds-dir" && value !== undefined) {
      options.seedsDir = resolve(value);
    } else if (flag === "--allow" && value !== undefined) {
      options.allow = resolve(value);
    } else if (flag === "--max-bytes" && value !== undefined) {
      options.maxBytes = Number(value);
    }
  }
  return options;
}

function isSessionFile(path) {
  if (!path.endsWith(".jsonl") || !existsSync(path)) {
    return false;
  }
  const firstLine = readFileSync(path, "utf8")
    .split("\n")
    .find((line) => line.trim() !== "");
  if (firstLine === undefined) {
    return false;
  }
  try {
    return JSON.parse(firstLine).type === "session";
  } catch {
    return false;
  }
}

function loadAllowList(path) {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

function isInside(directory, path) {
  const rel = relative(directory, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function stagedFiles(root) {
  const result = spawnSync(
    "git",
    ["-C", root, "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    // Failing open here would inspect nothing and print success, which is the one outcome the gate
    // exists to prevent: a missing git or a broken repository is a hard error, not an empty list.
    const detail = result.stderr.trim() === "" ? "no stderr" : result.stderr.trim();
    const status = result.status ?? result.signal ?? "unknown";
    throw new Error(`could not list staged files (git exited ${String(status)}): ${detail}`);
  }
  return result.stdout.split("\n").filter((line) => line.trim() !== "");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const allow = loadAllowList(options.allow);
  const findings = [];

  for (const staged of stagedFiles(options.root)) {
    const path = join(options.root, staged);
    if (!isSessionFile(path)) {
      continue;
    }
    const name = basename(path, ".jsonl");
    if (!isInside(options.seedsDir, path) || !allow.includes(name)) {
      findings.push(`${staged}: raw Session file; only curated seeds may be staged`);
      continue;
    }
    const size = statSync(path).size;
    if (size > options.maxBytes) {
      findings.push(`${staged}: oversized Session file (${String(size)} bytes)`);
    }
  }

  if (existsSync(options.seedsDir)) {
    for (const file of readdirSync(options.seedsDir)) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }
      const path = join(options.seedsDir, file);
      const name = basename(file, ".jsonl");
      if (!allow.includes(name)) {
        findings.push(
          `${relative(options.root, path)}: raw Session file; not in the curated seed list`,
        );
        continue;
      }
      if (!isSessionFile(path)) {
        findings.push(`${relative(options.root, path)}: not a pi Session file`);
        continue;
      }
      const size = statSync(path).size;
      if (size > options.maxBytes) {
        findings.push(
          `${relative(options.root, path)}: ${String(size)} bytes exceeds the ${String(options.maxBytes)}-byte bound`,
        );
      }
    }
  }

  if (findings.length > 0) {
    console.error(`[fixture-check] FAILED - ${String(findings.length)} problem(s):`);
    for (const finding of findings) {
      console.error(`  - ${finding}`);
    }
    process.exit(1);
  }
  console.log(`[fixture-check] OK - no raw or oversized Session file staged.`);
}

main();

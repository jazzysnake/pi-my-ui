#!/usr/bin/env node
// Raw theme colours in e2e specs freeze the palette in a test and bypass the design tokens.
// Resolve a token through `themeColor`; when a spec is asserting the palette itself, keep the
// literal values in `packages/e2e/src/palette.ts`, which is outside the tree this check scans.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ROOT = join("packages", "e2e", "test");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);
const COLOR_LITERAL = /(["'`])(rgba?\([^"'`]*\)|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)\1/g;

function rootFromArgs(argv) {
  const flag = argv.indexOf("--root");
  if (flag === -1) {
    return DEFAULT_ROOT;
  }
  const value = argv[flag + 1];
  if (value === undefined) {
    throw new Error("--root needs a directory");
  }
  return resolve(value);
}

const REPO_ROOT = rootFromArgs(process.argv.slice(2));

function filesUnder(directory, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      filesUnder(full, found);
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))
    ) {
      found.push(full);
    }
  }
  return found;
}

function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function main() {
  const findings = [];
  for (const file of filesUnder(join(REPO_ROOT, TEST_ROOT))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(COLOR_LITERAL)) {
      findings.push(
        `${relative(REPO_ROOT, file)}:${lineAt(text, match.index)}: ${match[1]}${match[2]}${match[1]}`,
      );
    }
  }

  if (findings.length > 0) {
    console.error(`[e2e-style] FAILED - ${String(findings.length)} raw theme colour literal(s):`);
    for (const finding of findings) {
      console.error(`  - ${finding}`);
    }
    console.error(
      "Resolve the token with `themeColor`, or keep the literal palette source in packages/e2e/src/palette.ts.",
    );
    process.exit(1);
  }

  console.log("[e2e-style] OK - e2e specs resolve theme colours through tokens.");
}

main();

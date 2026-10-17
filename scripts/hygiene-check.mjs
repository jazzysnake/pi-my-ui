#!/usr/bin/env node
// The mechanical half of the comment rules in AGENTS.md, run as the second half of `npm run lint`.
//
// A comment naming a ticket or a date narrates history, and history belongs in git, so those fail
// the gate. A long file or a heavily commented one is not a defect on its own: those warn, and the
// gate still passes so a reviewer makes the call.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Scan a different tree when a test injects one; the gate itself always scans the repo. */
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

const SCAN_ROOTS = ["packages", "scripts"];

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".worktrees",
  "test-results",
  "playwright-report",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".svelte",
]);

const MAX_CODE_LINES = 400;
const MAX_COMMENT_RATIO = 0.3;

// A ticket reference in any of the shapes a ticket is written in: a prefixed id, a bare numbered
// id, or a hash reference. The lookarounds keep a longer identifier from matching a fragment.
// A decision reference such as `ADR 0003` names the record the comment explains, so it stays
// allowed; the ticket-shaped patterns below are what fail.
const TICKET_REFERENCES = [
  /(?<![\w-])([A-Z][A-Za-z]*\d*-T\d+)(?![\w-])/i,
  /(?<![\w-])(T\d{2,})(?![\w-])/i,
  /(?<![\w])(#\d+)(?![\w])/,
  /\bticket\s+\d+\b/i,
  /\bstory\s+\d+\b/i,
];

// A date in the two shapes a comment carries: an ISO prefix and a month name with a year.
const DATE_REFERENCES = [
  /(?<!\d)(\d{4}-\d{2}(?:-\d{2})?)(?!\d)/,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/,
];

function filesUnder(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        filesUnder(full, found);
      }
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot !== -1 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) {
        found.push(full);
      }
    }
  }
  return found;
}

/**
 * Every comment in `text` as a half-open `[start, end)` offset pair, delimiters included. Strings
 * are skipped so a URL or a path inside one is not read as a comment, and `.svelte` markup
 * comments (`<!-- -->`) are read alongside `//` and block comments.
 */
function commentSpans(text) {
  const spans = [];
  let state = "code";
  let quote = "";
  let start = 0;
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];

    if (state === "code") {
      if (text.startsWith("<!--", index)) {
        state = "html";
        start = index;
        index += 4;
      } else if (character === "/" && next === "/") {
        state = "line";
        start = index;
        index += 2;
      } else if (character === "/" && next === "*") {
        state = "block";
        start = index;
        index += 2;
      } else if (character === '"' || character === "'" || character === "`") {
        quote = character;
        state = "string";
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }

    if (state === "string") {
      if (character === "\\") {
        index += 2;
      } else if (character === quote) {
        state = "code";
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }

    if (state === "line") {
      if (character === "\n") {
        spans.push([start, index]);
        state = "code";
      }
      index += 1;
      continue;
    }

    if (state === "block") {
      if (character === "*" && next === "/") {
        spans.push([start, index + 2]);
        state = "code";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (text.startsWith("-->", index)) {
      spans.push([start, index + 3]);
      state = "code";
      index += 3;
    } else {
      index += 1;
    }
  }

  if (state === "line" || state === "block" || state === "html") {
    spans.push([start, text.length]);
  }
  return spans;
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

/** `text` with every comment character blanked, so a whole-comment line leaves nothing behind. */
function maskComments(text, spans) {
  const characters = [...text];
  for (const [spanStart, spanEnd] of spans) {
    for (let index = spanStart; index < spanEnd; index += 1) {
      if (characters[index] !== "\n") {
        characters[index] = " ";
      }
    }
  }
  return characters.join("");
}

function inspectFile(file) {
  const text = readFileSync(file, "utf8");
  const spans = commentSpans(text);
  const findings = [];

  for (const [spanStart, spanEnd] of spans) {
    const comment = text.slice(spanStart, spanEnd);
    for (const pattern of [...TICKET_REFERENCES, ...DATE_REFERENCES]) {
      const match = pattern.exec(comment);
      if (match !== null) {
        const line = lineAt(text, spanStart + match.index);
        findings.push(
          `${relative(REPO_ROOT, file)}:${line}: comment contains "${match[1] ?? match[0]}"`,
        );
      }
    }
  }

  const masked = maskComments(text, spans);
  const originalLines = text.split("\n");
  const maskedLines = masked.split("\n");
  let codeLines = 0;
  let commentLines = 0;
  for (let index = 0; index < originalLines.length; index += 1) {
    const original = originalLines[index];
    const maskedLine = maskedLines[index];
    if (original === undefined || maskedLine === undefined || original.trim() === "") {
      continue;
    }
    if (maskedLine.trim() === "") {
      commentLines += 1;
    } else {
      codeLines += 1;
    }
  }

  const ratio = codeLines + commentLines === 0 ? 0 : commentLines / (codeLines + commentLines);
  const warnings = [];
  if (codeLines > MAX_CODE_LINES) {
    warnings.push(
      `${relative(REPO_ROOT, file)}: ${codeLines} code lines exceeds the ${MAX_CODE_LINES} warning bound`,
    );
  }
  if (ratio > MAX_COMMENT_RATIO) {
    warnings.push(
      `${relative(REPO_ROOT, file)}: ${Math.round(ratio * 100)}% comment lines exceeds the ${Math.round(
        MAX_COMMENT_RATIO * 100,
      )}% warning bound`,
    );
  }

  return { findings, warnings };
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => filesUnder(join(REPO_ROOT, root)));
  const findings = [];
  const warnings = [];

  for (const file of files) {
    const result = inspectFile(file);
    findings.push(...result.findings);
    warnings.push(...result.warnings);
  }

  for (const warning of warnings) {
    console.warn(`[hygiene] WARNING: ${warning}`);
  }

  if (findings.length > 0) {
    console.error(`[hygiene] FAILED - ${findings.length} comment(s) name a ticket or a date:`);
    for (const finding of findings) {
      console.error(`  - ${finding}`);
    }
    process.exit(1);
  }

  console.log(
    `[hygiene] OK - ${files.length} source file(s); ${warnings.length} warning(s), 0 failures.`,
  );
}

main();

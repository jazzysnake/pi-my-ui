/**
 * One tool call as a card needs it: which argument identifies the call, which ones are worth a line,
 * which one is too big to print, and how the output divides into a preview, a fold and the notice
 * that explains both.
 *
 * Every built-in tool states its limits at the END of its output — `[Showing lines 1-2000 of 8412.
 * Full output: /tmp/…]`, `[100 matches limit reached. Use limit=200 for more]`, `Command exited with
 * code 3`. A card that caps the output by lines hides exactly that, which is the one line a reader
 * needs, so the tail is parsed off before any cap is applied and stays on screen while the body
 * folds.
 */

import type { ToolCallBlock } from "@pi-my-ui/protocol";

/** Which family a tool belongs to; every per-tool decision in a card reads this once. */
export type ToolKind = "shell" | "read" | "grep" | "find" | "ls" | "other";

/** pi's two shell tools are one shape, so every card must treat them as one. */
export function kindOf(name: string): ToolKind {
  switch (name) {
    case "bash":
    case "powershell":
      return "shell";
    case "read":
      return "read";
    case "grep":
      return "grep";
    case "find":
      return "find";
    case "ls":
      return "ls";
    default:
      return "other";
  }
}

export function isShellTool(name: string): boolean {
  return kindOf(name) === "shell";
}

export function isListTool(name: string): boolean {
  const kind = kindOf(name);
  return kind === "grep" || kind === "find" || kind === "ls";
}

/**
 * What a folded preview shows. A command's output or a file's contents needs enough lines to
 * recognise the shape of what came back; a list of paths is scannable at four, and the space it
 * saves is what keeps a turn's later calls on screen.
 */
const PREVIEW_LINES: Readonly<Record<ToolKind, number>> = {
  shell: 6,
  read: 6,
  grep: 4,
  find: 4,
  ls: 4,
  other: 4,
};

export function previewLines(kind: ToolKind): number {
  return PREVIEW_LINES[kind];
}

/** What a folded output's leftovers are counted in, per tool. */
export function outputNoun(kind: ToolKind): readonly [string, string] {
  if (kind === "grep") {
    return ["match", "matches"];
  }
  return kind === "find" || kind === "ls" ? ["entry", "entries"] : ["line", "lines"];
}

function stringArg(block: ToolCallBlock, key: string): string | undefined {
  const value = block.arguments[key];
  return typeof value === "string" ? value : undefined;
}

function numberArg(block: ToolCallBlock, key: string): number | undefined {
  const value = block.arguments[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The argument that identifies the call; everything else on the prompt line is a detail. */
function targetKey(block: ToolCallBlock): string | undefined {
  const kind = kindOf(block.name);
  if (kind === "shell") {
    return "command";
  }
  if (kind === "grep" || kind === "find") {
    return "pattern";
  }
  for (const key of ["path", "pattern", "description"]) {
    if (typeof block.arguments[key] === "string") {
      return key;
    }
  }
  return undefined;
}

/**
 * The one string a reader needs to know which call this was: the command, the file, the pattern, or
 * the subagent's description.
 */
export function targetOf(block: ToolCallBlock): string {
  const key = targetKey(block);
  return key === undefined ? "" : (stringArg(block, key) ?? "");
}

export interface DetailPair {
  readonly key: string;
  readonly value: string;
}

/** Arguments whose whole point is that they are too big to sit on a line. */
const PAYLOAD_ARGUMENTS = new Set(["content", "edits", "prompt"]);

/** `read`'s window is stated as a range instead, so the two raw fields would only repeat it. */
const WINDOW_ARGUMENTS = new Set(["offset", "limit"]);

/**
 * Scalar arguments other than the target, flattened to one clipped line each. A nested value (an
 * MCP tool's object, an array option of an extension tool) is clipped JSON rather than dropped:
 * seeing that the argument exists matters more than its shape.
 */
export function detailPairs(block: ToolCallBlock): readonly DetailPair[] {
  const key = targetKey(block);
  const pairs: DetailPair[] = [];
  for (const [name, value] of Object.entries(block.arguments)) {
    if (name === key || PAYLOAD_ARGUMENTS.has(name)) {
      continue;
    }
    if (block.name === "read" && WINDOW_ARGUMENTS.has(name)) {
      continue;
    }
    if (typeof value === "string") {
      pairs.push({ key: name, value: clipText(value, 80) });
    } else if (typeof value === "number" || typeof value === "boolean") {
      pairs.push({ key: name, value: String(value) });
    } else if (value !== null && typeof value === "object") {
      pairs.push({ key: name, value: clipText(JSON.stringify(value), 80) });
    }
  }
  return pairs;
}

/** The line window a `read` asked for, when it named one. */
export function readWindow(block: ToolCallBlock): string | undefined {
  if (block.name !== "read") {
    return undefined;
  }
  const offset = numberArg(block, "offset");
  const limit = numberArg(block, "limit");
  if (offset === undefined && limit === undefined) {
    return undefined;
  }
  const start = offset ?? 1;
  return limit === undefined
    ? `from line ${String(start)}`
    : `lines ${String(start)}–${String(start + limit - 1)}`;
}

/** The first line number a `read` returned, so a preview numbers itself like the file did. */
export function readStart(block: ToolCallBlock): number {
  return block.name === "read" ? (numberArg(block, "offset") ?? 1) : 1;
}

export interface EditPair {
  readonly oldText: string;
  readonly newText: string;
}

/** The `edits[]` array of an `edit` call, dropping entries that do not carry both strings. */
export function editPairs(block: ToolCallBlock): readonly EditPair[] {
  const edits = block.arguments["edits"];
  if (!Array.isArray(edits)) {
    return [];
  }
  const pairs: EditPair[] = [];
  for (const entry of edits) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { oldText, newText } = entry as Record<string, unknown>;
    if (typeof oldText === "string" && typeof newText === "string") {
      pairs.push({ oldText, newText });
    }
  }
  return pairs;
}

export type Payload =
  | { readonly kind: "edits"; readonly pairs: readonly EditPair[] }
  | { readonly kind: "text"; readonly label: "content" | "prompt"; readonly text: string };

/** The argument that is the call's actual work, when it is too big to show inline. */
export function payloadOf(block: ToolCallBlock): Payload | null {
  const pairs = editPairs(block);
  if (pairs.length > 0) {
    return { kind: "edits", pairs };
  }
  const content = stringArg(block, "content");
  if (content !== undefined) {
    return { kind: "text", label: "content", text: content };
  }
  const prompt = stringArg(block, "prompt");
  if (prompt !== undefined) {
    return { kind: "text", label: "prompt", text: prompt };
  }
  return null;
}

/** A truncation or limit notice pi appended to the output, with its spill file when it named one. */
export interface OutputNotice {
  /** The notice without its brackets and without the spill clause, e.g. `Showing lines 1-2000 of 8412`. */
  readonly text: string;
  /** pi's temp file holding the output past the bound. */
  readonly path: string | null;
}

/** How a shell command ended, as pi appends it after the output. */
export type OutputEnding =
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "aborted" }
  | { readonly kind: "timeout"; readonly seconds: string }
  | { readonly kind: "no-exit-code" };

/** The shape pi gives each notice, so a command's own `[ok]` line is never mistaken for one. */
const NOTICE_PATTERNS: readonly RegExp[] = [
  /^\[Showing lines [^\]]*\]$/s,
  /^\[Showing last [^\]]*\]$/s,
  /^\[\d+ more lines in file[^\]]*\]$/s,
  /^\[[^\]]*limit reached[^\]]*\]$/s,
  /^\[[^\]]*truncated to \d+ chars[^\]]*\]$/s,
];

const SPILL_CLAUSE = /^(?<text>.*?) Full output: (?<path>\S+)$/su;

function parseNotice(paragraph: string): OutputNotice | null {
  if (!NOTICE_PATTERNS.some((pattern) => pattern.test(paragraph))) {
    return null;
  }
  const inner = paragraph.slice(1, -1);
  const spill = SPILL_CLAUSE.exec(inner);
  if (spill?.groups !== undefined) {
    return { text: spill.groups["text"] ?? inner, path: spill.groups["path"] ?? null };
  }
  return { text: inner, path: null };
}

function parseEnding(paragraph: string): OutputEnding | null {
  const exit = /^Command exited with code (-?\d+)$/u.exec(paragraph);
  if (exit !== null) {
    return { kind: "exit", code: Number(exit[1]) };
  }
  if (paragraph === "Command aborted") {
    return { kind: "aborted" };
  }
  const timeout = /^Command timed out after (?<seconds>\S+) seconds$/u.exec(paragraph);
  if (timeout?.groups !== undefined) {
    return { kind: "timeout", seconds: timeout.groups["seconds"] ?? "" };
  }
  if (paragraph === "Command terminated without an exit code") {
    return { kind: "no-exit-code" };
  }
  return null;
}

export interface OutputTail {
  /** The output itself, without the trailing notices and ending. */
  readonly body: string;
  readonly notices: readonly OutputNotice[];
  readonly ending: OutputEnding | null;
}

/**
 * Split pi's trailing notices and command ending off the output. Endings are a shell-only shape: the
 * same sentence can be a log line a `read` legitimately returned, and lifting it there would both
 * hide the line and label the card with a failure that never happened.
 */
export function outputTail(output: string, options: { readonly shell: boolean }): OutputTail {
  if (output === "") {
    return { body: "", notices: [], ending: null };
  }
  const paragraphs = output.split("\n\n");
  let ending: OutputEnding | null = null;
  if (options.shell) {
    const last = paragraphs[paragraphs.length - 1];
    if (last !== undefined) {
      const parsed = parseEnding(last.trim());
      if (parsed !== null) {
        ending = parsed;
        paragraphs.pop();
      }
    }
  }
  // pi joins several limits into one bracket, but popping one paragraph per shape costs nothing and
  // stops a second notice from ending up as the body's last line, where a fold would hide it.
  const notices: OutputNotice[] = [];
  for (;;) {
    const last = paragraphs[paragraphs.length - 1];
    if (last === undefined) {
      break;
    }
    const parsed = parseNotice(last.trim());
    if (parsed === null) {
      break;
    }
    notices.unshift(parsed);
    paragraphs.pop();
  }
  return { body: paragraphs.join("\n\n"), notices, ending };
}

/** The notices as the one line a card has for them, with the spill file they name. */
export interface NoticeSummary {
  readonly text: string;
  readonly path: string | null;
}

export function noticeSummary(notices: readonly OutputNotice[]): NoticeSummary {
  const path = notices.find((notice) => notice.path !== null)?.path ?? null;
  return { text: notices.map((notice) => notice.text).join(" · "), path };
}

/** The word that finishes a shell card's status: `exit 3`, `aborted`, `timed out`. */
export function endingLabel(ending: OutputEnding | null): string {
  if (ending === null) {
    return "";
  }
  switch (ending.kind) {
    case "exit":
      return `exit ${String(ending.code)}`;
    case "aborted":
      return "aborted";
    case "timeout":
      return "timed out";
    case "no-exit-code":
      return "no exit code";
  }
}

export interface ClippedText {
  readonly shown: readonly string[];
  /** Lines the fold is holding back. */
  readonly hidden: number;
  /** Of the lines shown, how many were cut short; a line count alone cannot express this. */
  readonly clamped: number;
}

/**
 * The first `maxLines` lines of `text`, each clamped to `maxChars`. Lines bound the scroll; the
 * clamp bounds a single line, so one minified file or one long grep match cannot become the whole
 * screen.
 */
export function clipLines(text: string, maxLines: number, maxChars: number): ClippedText {
  if (text === "") {
    return { shown: [], hidden: 0, clamped: 0 };
  }
  const lines = splitLines(text);
  const taken =
    maxLines === Number.POSITIVE_INFINITY ? lines : lines.slice(0, Math.max(0, maxLines));
  let clamped = 0;
  const shown = taken.map((line) => {
    if (line.length <= maxChars) {
      return line;
    }
    clamped += 1;
    return `${line.slice(0, maxChars - 1)}…`;
  });
  return { shown, hidden: lines.length - shown.length, clamped };
}

/** Keep both ends of a long value, which for a path is the directory and the file name. */
export function ellipsizeMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const head = Math.ceil((maxChars - 1) / 2);
  const tail = Math.floor((maxChars - 1) / 2);
  return `${text.slice(0, head)}…${tail === 0 ? "" : text.slice(text.length - tail)}`;
}

/**
 * One line, cut at `maxChars`. Values on the prompt line are flattened because an argument can carry
 * newlines (a heredoc, a patch) and a row of a prompt line cannot say where they were.
 */
export function clipText(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`;
}

/**
 * The lines a reader counts. A command's output ends with a newline, and the empty string after it is
 * not a line anyone sees, so it must not inflate a fold's count.
 */
function splitLines(text: string): string[] {
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

export function lineCount(text: string): number {
  return text === "" ? 0 : splitLines(text).length;
}

/** A size a phone reader can compare at a glance. */
export function sizeLabel(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

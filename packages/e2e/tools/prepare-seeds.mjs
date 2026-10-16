// Derive the committed Session seeds from the owner's real ges2t sessions.
//
// Raw sessions must never be committed: this tool reads them from a local session store, replaces
// every piece of free text and every path with synthetic content, and writes only the trimmed,
// sanitised results under `fixtures/seeds`. It is a one-off derivation, not part of `verify`, so a
// checkout without the owner's sessions still has usable seeds.
//
// Usage: node packages/e2e/tools/prepare-seeds.mjs <source-session-dir>
// The source directory is the owner's local session store for the project the seeds come from; it
// is passed in rather than baked in, so no local path is committed.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = process.argv[2] ?? process.env["PI_SEED_SOURCE_DIR"];
if (SOURCE_DIR === undefined || SOURCE_DIR === "") {
  console.error("usage: prepare-seeds.mjs <source-session-dir> (or set PI_SEED_SOURCE_DIR)");
  process.exit(1);
}
const OUTPUT_DIR = fileURLToPath(new URL("../fixtures/seeds/", import.meta.url));

const SEED_EPOCH_MS = Date.UTC(2025, 0, 1);
const SEED_EPOCH_STEP_MS = 1000;
const PLACEHOLDER_CWD = "/tmp/pi-my-ui-seed-workspace";

/** Session file size ceiling the fixture check enforces. Seeds must stay well under it. */
const MAX_SEED_BYTES = 128 * 1024;

function readSession(path) {
  const entries = [];
  let header = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const entry = JSON.parse(line);
    if (entry.type === "session") {
      header = entry;
      continue;
    }
    entries.push(entry);
  }
  return { header, entries };
}

function shapeOf(entries) {
  const children = new Map();
  for (const entry of entries) {
    const parent = entry.parentId ?? null;
    children.set(parent, (children.get(parent) ?? 0) + 1);
  }
  const branchPoint = [...children.values()].filter((count) => count > 1).length;
  const customRecords = entries.filter(
    (entry) => entry.type === "custom" && entry.customType === "subagents:record",
  ).length;
  const customAny = entries.some(
    (entry) => entry.type === "custom" || entry.type === "custom_message",
  );
  const compaction = entries.findIndex((entry) => entry.type === "compaction");
  return { count: entries.length, branchPoint, customRecords, customAny, compaction };
}

function replaceStrings(value, synthetic, depth = 0) {
  if (typeof value === "string") {
    return synthetic();
  }
  if (Array.isArray(value)) {
    // Arguments are capped because a real session's tool calls can carry whole file bodies, and a
    // seed only needs the shape of the call, not its payload.
    return value.slice(0, 2).map((item) => replaceStrings(item, synthetic, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = replaceStrings(item, synthetic, depth + 1);
    }
    return out;
  }
  return value;
}

function syntheticBlock(block, counter) {
  if (block.type === "text") {
    return { type: "text", text: `Seed text block ${counter.next()}.` };
  }
  if (block.type === "thinking") {
    return { type: "thinking", thinking: `Seed reasoning ${counter.next()}.` };
  }
  if (block.type === "toolCall") {
    return {
      type: "toolCall",
      id: counter.callId(block.id),
      name: block.name,
      arguments: replaceStrings(block.arguments, () => `seed-a-${counter.next()}`),
    };
  }
  if (block.type === "image") {
    return { type: "text", text: `Seed image omitted ${counter.next()}.` };
  }
  return { type: "text", text: `Seed block ${counter.next()}.` };
}

function syntheticContent(content, counter) {
  if (typeof content === "string") {
    return `Seed content ${counter.next()}.`;
  }
  if (!Array.isArray(content)) {
    return content;
  }
  return content
    .slice(0, 3)
    .map((block) =>
      block !== null && typeof block === "object" ? syntheticBlock(block, counter) : block,
    );
}

function sanitiseMessage(message, counter) {
  if (message === null || typeof message !== "object") {
    return message;
  }
  const out = { ...message };
  delete out.details;
  delete out.nestedCalls;
  delete out.diagnostics;
  delete out.responseId;
  delete out.rawStopReason;
  if (out.role === "system") {
    out.content = `Seed system prompt ${counter.next()}.`;
    delete out.sections;
    delete out.toolsAdded;
    delete out.toolsRemoved;
    return out;
  }
  if (typeof out.toolCallId === "string") {
    out.toolCallId = counter.callId(out.toolCallId);
  }
  out.content = syntheticContent(out.content, counter);
  return out;
}

function sanitiseSubagentRecord(data, counter) {
  return {
    id: counter.agentId(data?.id),
    type: "general-purpose",
    description: `Seed agent ${counter.next()}`,
    status: typeof data?.status === "string" ? data.status : "completed",
    result: `Seed agent result ${counter.next()}`,
    startedAt: 0,
    completedAt: 0,
  };
}

function sanitiseSubagentDetails(details, id, counter) {
  return {
    id,
    description: `Seed agent ${counter.next()}`,
    status: "completed",
    toolUses: Number(details?.toolUses ?? 0),
    turnCount: Number(details?.turnCount ?? 0),
    totalTokens: Number(details?.totalTokens ?? 0),
    totalCost: Number(details?.totalCost ?? 0),
    durationMs: Number(details?.durationMs ?? 0),
    outputFile: `/tmp/pi-my-ui-seed/${id}.output`,
    resultPreview: `Seed agent result ${counter.next()}`,
  };
}

function sanitiseNotification(agentId, counter) {
  return [
    "<task-notification>",
    `<task-id>${agentId}</task-id>`,
    "<status>Done</status>",
    `<summary>Seed agent ${counter.next()} completed</summary>`,
    `<result>Seed agent result ${counter.next()}</result>`,
    "</task-notification>",
  ].join("\n");
}

function sanitiseEntry(entry, counter) {
  const out = { ...entry };
  switch (entry.type) {
    case "message":
      out.message = sanitiseMessage(entry.message, counter);
      break;
    case "compaction":
      out.summary = `Seed compaction summary ${counter.next()}.`;
      delete out.details;
      if (out.systemMessage !== undefined) {
        out.systemMessage = sanitiseMessage(out.systemMessage, counter);
      }
      break;
    case "branch_summary":
      out.summary = `Seed branch summary ${counter.next()}.`;
      delete out.details;
      break;
    case "session_info":
      out.name = `Seed session ${counter.next()}`;
      break;
    case "label":
      out.label = `Seed label ${counter.next()}`;
      break;
    case "context_edit":
      out.replacement =
        entry.replacement === null
          ? null
          : { content: syntheticContent(entry.replacement.content, counter) };
      break;
    case "custom":
      out.data =
        entry.customType === "subagents:record"
          ? sanitiseSubagentRecord(entry.data, counter)
          : `seed-entry-${counter.next()}`;
      break;
    case "custom_message": {
      const agentId = counter.agentId(entry.details?.id);
      out.content =
        entry.customType === "subagent-notification"
          ? sanitiseNotification(agentId, counter)
          : `Seed extension message ${counter.next()}.`;
      if (entry.details !== undefined) {
        out.details = sanitiseSubagentDetails(entry.details, agentId, counter);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

function newCounter() {
  let value = 0;
  const callIds = new Map();
  const agentIds = new Map();
  const mint = (label) => {
    value += 1;
    return `${label}-${value}`;
  };
  const memoised = (map, label, original) => {
    const key = original ?? `anonymous-${value}`;
    let mapped = map.get(key);
    if (mapped === undefined) {
      mapped = mint(label);
      map.set(key, mapped);
    }
    return mapped;
  };
  return {
    next: () => {
      value += 1;
      return value;
    },
    callId: (original) => memoised(callIds, "seed-call", original),
    agentId: (original) => memoised(agentIds, "seed-agent", original),
  };
}

function rebaseTimestamps(entries, header, offsetSeconds) {
  const base = SEED_EPOCH_MS + offsetSeconds * 1000;
  const headerOut = { ...header, timestamp: new Date(base).toISOString() };
  const entriesOut = entries.map((entry, index) => {
    const stamp = new Date(base + (index + 1) * SEED_EPOCH_STEP_MS);
    const out = { ...entry, timestamp: stamp.toISOString() };
    if (out.message !== null && typeof out.message === "object") {
      out.message = { ...out.message, timestamp: stamp.getTime() };
    }
    return out;
  });
  return { header: headerOut, entries: entriesOut };
}

/** Keep a window of entries and make it self-contained: a foreign parent becomes the previous, or null. */
function windowEntries(entries, start, end) {
  const slice = entries.slice(start, end + 1);
  const kept = new Set(slice.map((entry) => entry.id));
  return slice.map((entry, index) => {
    if (index === 0) {
      return { ...entry, parentId: null };
    }
    if (entry.parentId !== null && !kept.has(entry.parentId)) {
      return { ...entry, parentId: slice[index - 1].id };
    }
    return entry;
  });
}

function writeSeed(name, header, entries, offsetSeconds) {
  const counter = newCounter();
  const sanitised = entries.map((entry) => sanitiseEntry(entry, counter));
  const rebased = rebaseTimestamps(sanitised, header, offsetSeconds);
  const syntheticHeader = {
    type: "session",
    version: 3,
    id: `01a10000-0000-7000-8000-${String(offsetSeconds).padStart(12, "0")}`,
    timestamp: rebased.header.timestamp,
    cwd: PLACEHOLDER_CWD,
  };
  const lines = [syntheticHeader, ...rebased.entries].map((entry) => JSON.stringify(entry));
  const text = `${lines.join("\n")}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_SEED_BYTES) {
    throw new Error(
      `${name}: ${String(bytes)} bytes exceeds the ${String(MAX_SEED_BYTES)}-byte seed bound`,
    );
  }
  writeFileSync(join(OUTPUT_DIR, `${name}.jsonl`), text);
  return { name, entries: rebased.entries.length, bytes, source: header?.cwd };
}

function main() {
  const files = readdirSync(SOURCE_DIR).filter((file) => file.endsWith(".jsonl"));
  const sessions = files.map((file) => {
    const path = join(SOURCE_DIR, file);
    const { header, entries } = readSession(path);
    return { file, header, entries, shape: shapeOf(entries) };
  });

  const plain = sessions
    .filter((s) => s.shape.compaction === -1 && !s.shape.customAny && s.shape.branchPoint === 0)
    .sort((a, b) => a.shape.count - b.shape.count)
    .find((s) => s.shape.count >= 20);

  const branching = sessions
    .map((s) => ({ session: s, branchIndex: branchIndex(s.entries) }))
    .filter((candidate) => candidate.branchIndex !== -1)
    .sort((a, b) => a.branchIndex - b.branchIndex)[0];

  const compaction = sessions
    .filter((s) => s.shape.compaction !== -1)
    .sort((a, b) => a.shape.count - b.shape.count)[0];

  const subagents = sessions
    .filter((s) => s.shape.compaction === -1)
    .sort((a, b) => b.shape.customRecords - a.shape.customRecords)[0];

  const large = sessions
    .filter((s) => s.shape.compaction === -1 && !s.shape.customAny)
    .sort((a, b) => b.shape.count - a.shape.count)[0];

  if (!plain || !branching || !compaction || !subagents || !large) {
    throw new Error(`could not find every seed shape under ${SOURCE_DIR}`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const written = [];

  written.push(writeSeed("plain", plain.header, plain.entries, 1));

  written.push(
    writeSeed(
      "branching",
      branching.session.header,
      windowEntries(
        branching.session.entries,
        0,
        Math.min(20, branching.session.entries.length - 1),
      ),
      2,
    ),
  );

  {
    const index = compaction.shape.compaction;
    const firstKept = compaction.entries.findIndex(
      (entry) => entry.id === compaction.entries[index].firstKeptEntryId,
    );
    const start = Math.max(0, (firstKept === -1 ? index : firstKept) - 3);
    const end = Math.min(compaction.entries.length - 1, index + 5);
    written.push(
      writeSeed("compaction", compaction.header, windowEntries(compaction.entries, start, end), 3),
    );
  }

  {
    const recordIndices = subagents.entries
      .map((entry, index) => (entry.customType === "subagents:record" ? index : -1))
      .filter((index) => index !== -1);
    // Five records packed as tightly as the session allows: the seed stays small while still
    // exercising several runs, and an isolated cluster keeps unrelated history out of it.
    const span = 5;
    let cluster = 0;
    let bestWidth = Number.POSITIVE_INFINITY;
    for (let start = 0; start + span - 1 < recordIndices.length; start += 1) {
      const first = recordIndices[start] ?? 0;
      const last = recordIndices[start + span - 1] ?? first;
      if (last - first < bestWidth) {
        bestWidth = last - first;
        cluster = start;
      }
    }
    const first = recordIndices[cluster] ?? 0;
    const lastRecord = recordIndices[cluster + span - 1] ?? first;
    const start = Math.max(0, first - 8);
    const end = Math.min(subagents.entries.length - 1, lastRecord + 6);
    written.push(
      writeSeed("subagents", subagents.header, windowEntries(subagents.entries, start, end), 4),
    );
  }

  written.push(
    writeSeed(
      "large",
      large.header,
      windowEntries(large.entries, 0, Math.min(149, large.entries.length - 1)),
      5,
    ),
  );

  for (const seed of written) {
    console.log(`${seed.name}: ${String(seed.entries)} entries, ${String(seed.bytes)} bytes`);
  }
  console.log(`source: ${SOURCE_DIR}`);
}

function branchIndex(entries) {
  const children = new Map();
  for (const entry of entries) {
    const parent = entry.parentId ?? null;
    if (!children.has(parent)) {
      children.set(parent, []);
    }
    children.get(parent).push(entry);
  }
  for (const [parent, kids] of children) {
    if (kids.length > 1 && parent !== null) {
      return entries.findIndex((entry) => entry.id === parent);
    }
  }
  return -1;
}

main();

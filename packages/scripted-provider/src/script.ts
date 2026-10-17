/**
 * The script format the scripted provider replays.
 *
 * A script is the model side of one recorded run: an ordered list of the assistant turns a model
 * produced, each bound to the message that prompted it. Recording the binding rather than only the
 * reply is what lets a replay refuse a prompt the recording never saw instead of improvising.
 */

import type { JsonValue } from "@earendil-works/pi-ai";

/** The message one scripted model call answers. */
export type ScriptExpectation =
  | {
      readonly role: "user";
      readonly text: string;
      readonly images?: number;
      /** Text the whole model context must not contain; the way an excluded command is proven. */
      readonly contextExcludes?: string;
    }
  | { readonly role: "toolResult"; readonly toolName: string; readonly text?: string };

/** An assistant turn as a session file stores it: content blocks plus how the turn ended. */
export interface ScriptedReply {
  readonly content: readonly ScriptedBlock[];
  readonly stopReason: "stop" | "toolUse" | "length" | "error";
  /** The provider failure, required when `stopReason` is `"error"`. */
  readonly errorMessage?: string;
}

export type ScriptedBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly thinking: string }
  | {
      readonly type: "toolCall";
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, JsonValue>;
    };

export interface ScriptStep {
  readonly expect: ScriptExpectation;
  readonly reply: ScriptedReply;
}

export type Script = readonly ScriptStep[];

/** A script that cannot be replayed. Thrown while loading, so a broken recording never runs. */
export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptError";
  }
}

function fail(source: string, where: string, detail: string): never {
  throw new ScriptError(`${source}: ${where}: ${detail}`);
}

function asRecord(value: unknown, source: string, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(source, where, "expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function parseExpectation(value: unknown, source: string, where: string): ScriptExpectation {
  const record = asRecord(value, source, where);
  const role = record["role"];
  if (role === "user") {
    const text = record["text"];
    if (typeof text !== "string") {
      fail(source, where, 'a user expectation needs a string "text"');
    }
    const images = record["images"];
    if (images !== undefined && (typeof images !== "number" || !Number.isSafeInteger(images))) {
      fail(source, where, '"images" must be a whole number when present');
    }
    const contextExcludes = record["contextExcludes"];
    if (
      contextExcludes !== undefined &&
      (typeof contextExcludes !== "string" || contextExcludes === "")
    ) {
      fail(source, where, '"contextExcludes" must be a non-empty string when present');
    }
    return {
      role: "user",
      text,
      ...(images === undefined ? {} : { images }),
      ...(contextExcludes === undefined ? {} : { contextExcludes }),
    };
  }
  if (role === "toolResult") {
    const toolName = record["toolName"];
    if (typeof toolName !== "string") {
      fail(source, where, 'a toolResult expectation needs a string "toolName"');
    }
    const text = record["text"];
    if (text !== undefined && typeof text !== "string") {
      fail(source, where, '"text" must be a string when present');
    }
    return text === undefined
      ? { role: "toolResult", toolName }
      : { role: "toolResult", toolName, text };
  }
  return fail(source, where, 'expectation "role" must be "user" or "toolResult"');
}

function parseBlock(value: unknown, source: string, where: string): ScriptedBlock {
  const record = asRecord(value, source, where);
  const type = record["type"];
  if (type === "text") {
    const text = record["text"];
    if (typeof text !== "string") {
      fail(source, where, 'a text block needs a string "text"');
    }
    return { type: "text", text };
  }
  if (type === "thinking") {
    const thinking = record["thinking"];
    if (typeof thinking !== "string") {
      fail(source, where, 'a thinking block needs a string "thinking"');
    }
    return { type: "thinking", thinking };
  }
  if (type === "toolCall") {
    const id = record["id"];
    const name = record["name"];
    const args = record["arguments"];
    if (typeof id !== "string" || typeof name !== "string") {
      fail(source, where, 'a toolCall block needs string "id" and "name"');
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      fail(source, where, 'a toolCall block needs an object "arguments"');
    }
    // JSON.parse guarantees the values are JSON, so the cast only re-narrows what the parser erased.
    return { type: "toolCall", id, name, arguments: args as Record<string, JsonValue> };
  }
  return fail(source, where, `unknown content block type ${JSON.stringify(type)}`);
}

function parseReply(value: unknown, source: string, where: string): ScriptedReply {
  const record = asRecord(value, source, where);
  const rawContent = record["content"];
  if (!Array.isArray(rawContent)) {
    fail(source, where, 'a reply needs a "content" array');
  }
  const content = rawContent.map((block, index) =>
    parseBlock(block, source, `${where}.content[${String(index)}]`),
  );

  const stopReason = record["stopReason"];
  if (
    stopReason !== "stop" &&
    stopReason !== "toolUse" &&
    stopReason !== "length" &&
    stopReason !== "error"
  ) {
    fail(source, where, '"stopReason" must be "stop", "toolUse", "length" or "error"');
  }

  const errorMessage = record["errorMessage"];
  if (stopReason === "error") {
    // A failed turn without a message cannot be told from a refusal or retried meaningfully.
    if (typeof errorMessage !== "string" || errorMessage === "") {
      fail(source, where, 'a reply with stopReason "error" needs a non-empty "errorMessage"');
    }
  } else if (errorMessage !== undefined) {
    fail(source, where, '"errorMessage" is only valid with stopReason "error"');
  }

  // Pi decides whether to run tools from the stop reason, so a mismatched recording would either
  // run tools the model did not call or drop the ones it did.
  const callsTools = content.some((block) => block.type === "toolCall");
  if (callsTools !== (stopReason === "toolUse")) {
    fail(
      source,
      where,
      'a reply with a toolCall block must have stopReason "toolUse", and only then',
    );
  }
  return errorMessage === undefined
    ? { content, stopReason }
    : { content, stopReason, errorMessage };
}

/** Parse and validate a script. Every problem is reported with its source location. */
export function parseScript(text: string, source: string): Script {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(source, "document", `not valid JSON (${detail})`);
  }
  if (!Array.isArray(parsed)) {
    fail(source, "document", "a script must be a JSON array of steps");
  }
  if (parsed.length === 0) {
    fail(source, "document", "a script must contain at least one step");
  }
  return parsed.map((step, index) => {
    const where = `step ${String(index)}`;
    const record = asRecord(step, source, where);
    return {
      expect: parseExpectation(record["expect"], source, `${where}.expect`),
      reply: parseReply(record["reply"], source, `${where}.reply`),
    };
  });
}

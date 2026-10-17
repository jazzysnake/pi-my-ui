import type { Message } from "@earendil-works/pi-ai";

import { ScriptError, type ScriptExpectation } from "./script.js";

/** Plain text of a message's content, so a script can match what the model actually received. */
export function textOf(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** The number of image blocks a message carries; a string content carries none. */
export function imageCountOf(content: Message["content"]): number {
  if (typeof content === "string") {
    return 0;
  }
  return content.filter((block) => block.type === "image").length;
}

/** The message a model call is answering: the last one pi sends the model, ignoring prompt state. */
export function lastModelVisibleMessage(messages: readonly Message[]): Message {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role !== "system") {
      return message;
    }
  }
  throw new ScriptError("scripted provider: the transcript has no model-visible message");
}

function describe(message: Message): string {
  if (message.role === "user") {
    return `user ${JSON.stringify(textOf(message.content))}`;
  }
  if (message.role === "toolResult") {
    return `tool result from ${message.toolName} ${JSON.stringify(textOf(message.content))}`;
  }
  return `${message.role} message`;
}

function describeExpectation(expect: ScriptExpectation): string {
  if (expect.role === "user") {
    const images = expect.images === undefined ? "" : ` with ${String(expect.images)} image(s)`;
    return `user ${JSON.stringify(expect.text)}${images}`;
  }
  return `tool result from ${expect.toolName}`;
}

/**
 * The text a model call received across every model-visible message, for a context-wide assertion
 * that is not about the message being answered.
 */
function contextText(messages: readonly Message[]): string {
  return messages.map((message) => textOf(message.content)).join("\n");
}

/**
 * Fail unless the call's context matches what the script bound to it. Refusing here is the point: a
 * replay that improvised around a prompt the recording never saw would hide a changed transcript.
 */
export function assertExpectation(expect: ScriptExpectation, messages: readonly Message[]): void {
  const incoming = lastModelVisibleMessage(messages);
  if (expect.role === "user") {
    if (
      expect.contextExcludes !== undefined &&
      contextText(messages).includes(expect.contextExcludes)
    ) {
      throw new ScriptError(
        `scripted provider: the model context contains ${JSON.stringify(
          expect.contextExcludes,
        )}, which the script says it must not`,
      );
    }
    if (incoming.role !== "user" || textOf(incoming.content) !== expect.text) {
      throw new ScriptError(
        `scripted provider: expected ${describeExpectation(expect)} but received ${describe(incoming)}`,
      );
    }
    if (expect.images !== undefined && imageCountOf(incoming.content) !== expect.images) {
      throw new ScriptError(
        `scripted provider: expected ${String(expect.images)} image(s) but received ${String(
          imageCountOf(incoming.content),
        )}`,
      );
    }
    return;
  }
  if (incoming.role !== "toolResult" || incoming.toolName !== expect.toolName) {
    throw new ScriptError(
      `scripted provider: expected ${describeExpectation(expect)} but received ${describe(incoming)}`,
    );
  }
  if (expect.text !== undefined && textOf(incoming.content) !== expect.text) {
    throw new ScriptError(
      `scripted provider: expected tool result text ${JSON.stringify(expect.text)} but received ${JSON.stringify(
        textOf(incoming.content),
      )}`,
    );
  }
}

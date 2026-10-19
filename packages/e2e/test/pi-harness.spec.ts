import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import type { Script } from "@pi-my-ui/scripted-provider";

import { createHermeticHome, startScriptedPi, type PiTurn } from "../src/pi-harness";

/** Every reply pi recorded during a turn, as its text content. */
function replyTexts(turn: PiTurn): string[] {
  return turn.replies.map((reply) =>
    reply.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
  );
}

const REPLY_SCRIPT: Script = [
  {
    expect: { role: "user", text: "say hello" },
    reply: { content: [{ type: "text", text: "hello from the script" }], stopReason: "stop" },
  },
];

test("sends a prompt to real pi and receives the scripted reply", async () => {
  const home = await createHermeticHome();
  const pi = await startScriptedPi({ home, script: REPLY_SCRIPT });
  try {
    const turn = await pi.prompt("say hello");

    expect(turn.error).toBeUndefined();
    expect(replyTexts(turn)).toEqual(["hello from the script"]);
    expect(turn.replies[0]).toMatchObject({
      role: "assistant",
      provider: "scripted",
      model: "scripted",
      stopReason: "stop",
    });
  } finally {
    await pi.stop();
    await home.dispose();
  }
});

const WRITE_SCRIPT: Script = [
  {
    expect: { role: "user", text: "write hello.txt" },
    reply: {
      content: [
        { type: "text", text: "writing it" },
        {
          type: "toolCall",
          id: "call_write_1",
          name: "write",
          arguments: { path: "hello.txt", content: "hi from the tool" },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    // The exact result text only appears in the transcript if real pi ran the tool and fed its
    // result back, so matching it is what makes this turn prove the round trip.
    expect: {
      role: "toolResult",
      toolName: "write",
      text: "Successfully wrote to hello.txt",
    },
    reply: { content: [{ type: "text", text: "the file is written" }], stopReason: "stop" },
  },
];

test("runs a scripted tool call in the hermetic workspace and feeds the real result back", async () => {
  const home = await createHermeticHome();
  const pi = await startScriptedPi({ home, script: WRITE_SCRIPT });
  try {
    const turn = await pi.prompt("write hello.txt");

    expect(turn.error).toBeUndefined();
    expect(replyTexts(turn)).toEqual(["writing it", "the file is written"]);
    expect(turn.replies[0]?.content.some((block) => block.type === "toolCall")).toBe(true);
    expect(turn.events.some((event) => event.type === "tool_execution_end")).toBe(true);

    const written = join(home.workspace, "hello.txt");
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toBe("hi from the tool");
  } finally {
    await pi.stop();
    await home.dispose();
  }
});

test("fails loudly on a prompt the script does not expect", async () => {
  const home = await createHermeticHome();
  const pi = await startScriptedPi({ home, script: REPLY_SCRIPT });
  try {
    await expect(pi.prompt("a prompt the recording never saw")).rejects.toThrow(
      /scripted provider: expected user "say hello"/,
    );
  } finally {
    await pi.stop();
    await home.dispose();
  }
});

test("gives every test its own hermetic pi home and port namespace", async () => {
  const first = await createHermeticHome();
  const second = await createHermeticHome();
  try {
    expect(first.root).not.toBe(second.root);
    expect(first.home.startsWith(tmpdir())).toBe(true);
    expect(first.agentDir.startsWith(first.root)).toBe(true);
    expect(first.agentDir).not.toBe(second.agentDir);
    expect(first.ports.allocate()).not.toBe(second.ports.allocate());
    expect(first.ports.allocate()).not.toBe(first.ports.allocate());

    const pi = await startScriptedPi({ home: first, script: REPLY_SCRIPT });
    try {
      await pi.prompt("say hello");
    } finally {
      await pi.stop();
    }

    const sessionFiles = await readdir(first.sessionsDir, { recursive: true });
    expect(sessionFiles.some((name) => name.endsWith(".jsonl"))).toBe(true);
    // The child wrote its Session under the hermetic tree, never under the developer's own pi home.
    expect(first.sessionsDir.startsWith(first.root)).toBe(true);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

import { readFile } from "node:fs/promises";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { expect, test } from "@playwright/test";

import type { Script, ScriptedBlock } from "@pi-my-ui/scripted-provider";
import { scriptFromSession } from "@pi-my-ui/scripted-provider/record";

import { createHermeticHome, startScriptedPi, type PiTurn } from "../src/pi-harness";
import { firstUserPrompt, loadRecordedScript, recordedScriptNames } from "../src/recorded-scripts";

const PI_TEST_TIMEOUT_MS = 90_000;

test.describe.configure({ timeout: PI_TEST_TIMEOUT_MS });

/** The model calls of one recorded run, with provider-only fields removed. */
const RECORDED_RUN: Script = [
  {
    expect: { role: "user", text: "write a note" },
    reply: {
      content: [
        { type: "thinking", thinking: "I will write the note." },
        { type: "text", text: "Writing the note." },
        {
          type: "toolCall",
          id: "call_record_1",
          name: "write",
          arguments: { path: "note.txt", content: "recorded" },
        },
      ],
      stopReason: "toolUse",
    },
  },
  {
    expect: { role: "toolResult", toolName: "write", text: "Successfully wrote to note.txt" },
    reply: { content: [{ type: "text", text: "The note is written." }], stopReason: "stop" },
  },
];

function blockShape(block: AssistantMessage["content"][number]): ScriptedBlock {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "thinking") {
    return { type: "thinking", thinking: block.thinking };
  }
  return { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments };
}

/** The assistant turns of a run in the script's own shape, so a recording can be compared to it. */
function turnShapes(turn: PiTurn): ScriptedBlock[][] {
  return turn.replies.map((reply) => reply.content.map(blockShape));
}

test("records a real pi run into a script and replays it identically", async () => {
  const home = await createHermeticHome();
  try {
    const first = await startScriptedPi({ home, script: RECORDED_RUN });
    let sessionFile: string | undefined;
    try {
      await first.prompt("write a note");
      sessionFile = (await first.child.getState()).sessionFile;
    } finally {
      await first.stop();
    }
    expect(sessionFile).toBeDefined();

    const entries = parseSessionEntries(await readFile(sessionFile ?? "", "utf8"));
    const recorded = scriptFromSession(entries, "recording");

    // The recording is pi's own account of the run, so it must match the run that produced it.
    expect(recorded).toEqual(RECORDED_RUN);

    const replay = await startScriptedPi({ home, script: recorded });
    try {
      const turn = await replay.prompt("write a note");
      expect(turnShapes(turn)).toEqual(recorded.map((step) => step.reply.content));
      expect(turn.replies.map((reply) => reply.stopReason)).toEqual(
        recorded.map((step) => step.reply.stopReason),
      );
    } finally {
      await replay.stop();
    }
  } finally {
    await home.dispose();
  }
});

test("replays a committed recording identically through the scripted provider", async () => {
  const names = await recordedScriptNames();
  expect(names.length).toBeGreaterThan(0);

  const home = await createHermeticHome();
  try {
    for (const name of names) {
      const recorded = await loadRecordedScript(name);
      const pi = await startScriptedPi({ home, script: recorded });
      try {
        const turn = await pi.prompt(firstUserPrompt(recorded));
        expect(turnShapes(turn)).toEqual(recorded.map((step) => step.reply.content));
        expect(turn.replies.map((reply) => reply.stopReason)).toEqual(
          recorded.map((step) => step.reply.stopReason),
        );
      } finally {
        await pi.stop();
      }
    }
  } finally {
    await home.dispose();
  }
});

test("records a compacted Session as a compaction step carrying pi's own summary", () => {
  // pi stores the summary a compaction produced, so the recorded reply is the model's own words; the
  // request it answered is bound by the shape of pi's summary call, which a Session file does not hold.
  const entries = parseSessionEntries(
    [
      { type: "session", version: 3, id: "session", timestamp: "2030-01-01T00:00:00.000Z" },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2030-01-01T00:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "write a note" }],
          timestamp: 1,
        },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2030-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "The note is written." }],
          stopReason: "stop",
          timestamp: 2,
        },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "a1",
        timestamp: "2030-01-01T00:00:03.000Z",
        summary: "The note was written.",
        firstKeptEntryId: "u1",
        tokensBefore: 1200,
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
  );

  expect(scriptFromSession(entries, "compacted session")).toEqual([
    {
      expect: { role: "user", text: "write a note" },
      reply: { content: [{ type: "text", text: "The note is written." }], stopReason: "stop" },
    },
    {
      expect: { role: "compaction" },
      reply: { content: [{ type: "text", text: "The note was written." }], stopReason: "stop" },
    },
  ]);
});

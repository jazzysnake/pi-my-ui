/**
 * PROTOTYPE — content for the transcript-row variants, not production code.
 *
 * Only text and protocol-shaped blocks live here: each variant owns its own markup, because the
 * thing being judged is where the row boundary goes, not the words in it.
 */

import { ContentBlockType, ToolCallStatus, type ToolCallBlock } from "@pi-my-ui/protocol";

export const USER_TEXT =
  "the copy button should belong to the message it copies, not to the thinking row above it";

export const PARAGRAPH =
  "Ticket 60 is done and merged — 9d16dc6 (2 parents), pushed (origin/main at 74894cd). This sentence runs long enough to wrap on a phone, so the copy control's place can be judged against the first line of a message that opens with a collapsed thinking row.";

export const TAIL =
  "Two things to expect: it types while you speak, and transcribe.engine now streams the final text.";

export const TABLE: readonly (readonly [string, string])[] = [
  ["check", "result"],
  ["tests", "1386 passed, 3 skipped (was 1374)"],
  ["mypy", "0 errors / 72 files"],
  ["R1", "resolved by unification — transcribe() now drains stream()"],
];

export const THINKING_TEXT = [
  "Done. Now report the milestone.",
  "",
  "Key points:",
  "- Ticket 60 done/merged/pushed.",
  "- main: 1386 passed, 3 skipped; mypy 0/72.",
  "- R1 resolved by unification.",
  "",
  "Let me write a concise report and offer the next step. Let me write.",
].join("\n");

export const CODE_SNIPPET = `ges2t setup nemo_speech        # prebuilt Vulkan engine + GGUF (pinned, no sudo)
# then in ~/.config/ges2t/config.toml:
#   [transcriber]
#   engine = "nemo_speech"`;

export const CODE_SHORT = `pi --cwd /tmp/pi-my-ui`;

export const NOTIFICATION_PAYLOAD = [
  "<task-notification>",
  "<status>Done</status>",
  "<summary>Seed agent 4 completed</summary>",
  "<result>branch qemu-seed committed and pushed</result>",
  "</task-notification>",
].join("\n");

export const NETWORK_ERROR = "Network error: fetch failed (ECONNRESET) after 3 attempts";
export const CONNECTION_ERROR = "Connection error: the model stream closed before the first token";

const call = (
  id: string,
  name: string,
  status: ToolCallStatus,
  output?: string,
): ToolCallBlock => ({
  type: ContentBlockType.ToolCall,
  id,
  name,
  arguments: {},
  status,
  ...(output === undefined ? {} : { output }),
});

export const DONE_CALL = call("call-1", "bash", ToolCallStatus.Success, "1386 passed, 3 skipped");
export const RUNNING_CALL = call("call-2", "read", ToolCallStatus.Running);
export const FAILED_CALL = call(
  "call-3",
  "bash",
  ToolCallStatus.Error,
  "error: ENOENT: no such file or directory, open '.scratch/spec.md'",
);

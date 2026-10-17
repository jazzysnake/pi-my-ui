/** Text derivations the transcript needs from a ProjectedEntry, shared by its row components. */

import {
  ContentBlockType,
  EntryKind,
  type ContentBlock,
  type ProjectedEntry,
} from "@pi-my-ui/protocol";

/** The label a notification falls back to when its payload carries no readable summary. */
export const NOTIFICATION_FALLBACK_SUMMARY = "Extension message";

const SUMMARY_ELEMENT = /<summary>([\s\S]*?)<\/summary>/;
const NOTIFICATION_SUMMARY_MAX = 200;

/** The predefined entities a producer escapes before writing a summary element. */
const XML_ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&amp;/g, "&"],
];

function decodeXmlEntities(value: string): string {
  let decoded = value;
  for (const [pattern, replacement] of XML_ENTITIES) {
    decoded = decoded.replace(pattern, replacement);
  }
  return decoded;
}

/**
 * One block's contribution to the clipboard text. The switch covers the whole `ContentBlock` union
 * with a `never` default, so a new block type has to decide what it copies rather than quietly
 * copying nothing.
 */
function blockCopyText(block: ContentBlock): string {
  switch (block.type) {
    case ContentBlockType.Text:
      return block.text;
    case ContentBlockType.BashExecution:
      return [`$ ${block.command}`, block.output].filter((part) => part !== "").join("\n");
    case ContentBlockType.Reasoning:
    case ContentBlockType.ToolCall:
    case ContentBlockType.Error:
      // A failure is the record of what stopped the turn, not text the reader quotes.
      return "";
    default: {
      const unhandled: never = block;
      return unhandled;
    }
  }
}

/**
 * A message's clipboard text: its concatenated text blocks, with a bash card contributing its command
 * and output so its copy control is not inert.
 */
export function entryText(entry: ProjectedEntry): string {
  // A boundary carries no copy control, but its summary is the only text it has.
  if (entry.kind === EntryKind.CompactionBoundary) {
    return entry.summary;
  }
  return entry.blocks
    .map(blockCopyText)
    .filter((part) => part !== "")
    .join("\n\n");
}

/**
 * The one-line label for an extension notification. The producer's own `<summary>` element is the
 * only naming the payload carries, so it wins; an unrecognised payload gets the fallback rather than
 * raw XML as a heading.
 */
export function notificationSummary(text: string): string {
  const raw = SUMMARY_ELEMENT.exec(text)?.[1];
  if (raw === undefined) {
    return NOTIFICATION_FALLBACK_SUMMARY;
  }
  const summary = decodeXmlEntities(raw).replace(/\s+/g, " ").trim();
  return summary === ""
    ? NOTIFICATION_FALLBACK_SUMMARY
    : summary.slice(0, NOTIFICATION_SUMMARY_MAX);
}

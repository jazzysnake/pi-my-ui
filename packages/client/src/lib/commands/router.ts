/**
 * One function decides what a composer submission means, in this order:
 *
 *  1. a built-in (`/name`) runs its one action and is never sent to the model;
 *  2. a TUI-only command (`/settings`) is refused and is never sent to the model either;
 *  3. everything else is forwarded to pi as written, so a prompt template, a skill or an
 *     unrecognised `/foo` an extension handles all keep their exact text.
 */

import { findBuiltinByName } from "./builtins.js";
import type { BuiltinCommand } from "./builtins.js";
import { isTuiOnlyCommand } from "./tui-only.js";

/** What a composer submission means. */
export const ComposerRouteKind = {
  Prompt: "prompt",
  Builtin: "builtin",
  TuiOnly: "tuiOnly",
} as const;

export type ComposerRouteKind = (typeof ComposerRouteKind)[keyof typeof ComposerRouteKind];

export type ComposerRoute =
  | { readonly kind: typeof ComposerRouteKind.Prompt; readonly text: string }
  | {
      readonly kind: typeof ComposerRouteKind.Builtin;
      readonly command: BuiltinCommand;
      readonly args: string;
    }
  | { readonly kind: typeof ComposerRouteKind.TuiOnly; readonly name: string };

/** The character that opens the palette and marks a slash command. */
export const SLASH_PREFIX = "/";

/**
 * The text after a leading `/` while the palette should be open, or `null`. Anything past the first
 * whitespace is an argument, so the palette closes as soon as the user types a space and never
 * covers the completed command. A bare `/` opens the palette with an empty query.
 */
export function paletteQuery(text: string): string | null {
  if (!text.startsWith(SLASH_PREFIX)) {
    return null;
  }
  const body = text.slice(SLASH_PREFIX.length);
  return /\s/.test(body) ? null : body;
}

export interface ParsedSlashCommand {
  readonly name: string;
  readonly args: string;
}

/**
 * Parse text that begins with `/` into its name and arguments, or `null` when it does not. The name
 * is the text up to the first whitespace and the arguments are the trimmed remainder.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  if (!text.startsWith(SLASH_PREFIX)) {
    return null;
  }
  const body = text.slice(SLASH_PREFIX.length);
  const separator = body.search(/\s/);
  if (separator === -1) {
    return { name: body, args: "" };
  }
  return { name: body.slice(0, separator), args: body.slice(separator + 1).trim() };
}

/** Route one composer submission. Non-slash text is always a prompt. */
export function routeComposerSubmission(text: string): ComposerRoute {
  const parsed = parseSlashCommand(text);
  if (parsed === null) {
    return { kind: ComposerRouteKind.Prompt, text };
  }
  const builtin = findBuiltinByName(parsed.name);
  if (builtin !== null) {
    return { kind: ComposerRouteKind.Builtin, command: builtin.command, args: parsed.args };
  }
  if (isTuiOnlyCommand(parsed.name)) {
    return { kind: ComposerRouteKind.TuiOnly, name: parsed.name };
  }
  return { kind: ComposerRouteKind.Prompt, text };
}

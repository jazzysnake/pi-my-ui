/**
 * The pi commands that exist only in pi's own TUI. pi's `prompt` RPC does not implement them, so
 * forwarding one as prompt text would send a literal `/settings` to the model — a silent, wrong
 * degradation. The router refuses every name here and never emits a prompt for it.
 */

import { slashName } from "./builtins.js";

/** The pi TUI-only command names, without the leading `/`. */
export const TUI_ONLY_COMMANDS = [
  "settings",
  "hotkeys",
  "login",
  "logout",
  "llama",
  "scoped-models",
  "theme",
  "trust",
  "changelog",
  "quit",
  "share",
  "bug",
  "copy",
] as const;

export type TuiOnlyCommand = (typeof TUI_ONLY_COMMANDS)[number];

/** Whether `name` is a pi TUI-only command; `name` is untrusted input. */
export function isTuiOnlyCommand(name: string): boolean {
  return (TUI_ONLY_COMMANDS as readonly string[]).includes(name);
}

/** The one refusal message for the whole list. */
export function tuiOnlyRefusalMessage(name: string): string {
  return `${slashName(name)} is a pi TUI-only command and is not available in pi-my-ui`;
}

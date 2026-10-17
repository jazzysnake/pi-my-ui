/**
 * The palette's rows: the client's built-ins and the Pi child's discoverable commands (prompt
 * templates, skills and extension commands) in one list. A chosen row completes the name into the
 * composer with one trailing space; it never runs anything.
 */

import type { CommandInfo } from "@pi-my-ui/protocol";

import { BUILTIN_COMMANDS, findBuiltinByName, slashName } from "./builtins.js";
import { filterByFuzzyQuery } from "./filter.js";

/** One palette row; `badge` is {@link BUILTIN_BADGE} for a built-in and pi's source otherwise. */
export interface PaletteEntry {
  /** Stable key for keyed rendering and tests: the origin plus the name. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly badge: string;
}

/** The badge shown for a built-in row; discoverable rows use their own source. */
export const BUILTIN_BADGE = "built-in";

/**
 * Every built-in, then every discoverable command a built-in does not already own. A shadowed row is
 * dropped rather than shown unselectable, because the router gives the built-in the name and a tap
 * would run something other than the row's badge.
 */
export function buildPaletteEntries(commands: readonly CommandInfo[]): readonly PaletteEntry[] {
  const builtins: PaletteEntry[] = BUILTIN_COMMANDS.map((spec) => ({
    key: `builtin:${spec.command}`,
    name: spec.command,
    description: spec.description,
    badge: BUILTIN_BADGE,
  }));
  const discovered: PaletteEntry[] = commands
    .filter((command) => findBuiltinByName(command.name) === null)
    .map((command) => ({
      key: `${command.source}:${command.name}`,
      name: command.name,
      description: command.description,
      badge: command.source,
    }));
  return [...builtins, ...discovered];
}

/** Fuzzy-filter the rows by the text after the `/`. */
export function filterPaletteEntries(
  entries: readonly PaletteEntry[],
  query: string,
): readonly PaletteEntry[] {
  return filterByFuzzyQuery(entries, query, (entry) => entry.name);
}

/** The text a chosen row inserts into the composer: the slash name and one trailing space. */
export function completionText(name: string): string {
  return `${slashName(name)} `;
}

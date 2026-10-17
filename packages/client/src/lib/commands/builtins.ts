/**
 * The built-ins the client offers, declared once. The command id is the slash name without its `/`,
 * so {@link slashName} is the only place the prefix is added and a built-in cannot have two
 * spellings. The action of each built-in lives in one place (`runBuiltin` in the Shell, or the
 * composer's own picker for the two status controls); this list is what the palette renders and what
 * the router matches against.
 */

export const BuiltinCommand = {
  Tree: "tree",
  Compact: "compact",
  Model: "model",
  Thinking: "thinking",
  New: "new",
  Resume: "resume",
  Fork: "fork",
  Clone: "clone",
  Name: "name",
  Session: "session",
  Export: "export",
} as const;

export type BuiltinCommand = (typeof BuiltinCommand)[keyof typeof BuiltinCommand];

export interface BuiltinSpec {
  readonly command: BuiltinCommand;
  readonly description: string;
}

/** Every built-in, in the order the palette lists them. */
export const BUILTIN_COMMANDS: readonly BuiltinSpec[] = [
  { command: BuiltinCommand.Tree, description: "Open the message tree and switch branches" },
  {
    command: BuiltinCommand.Compact,
    description: "Compact the conversation, optionally with instructions",
  },
  { command: BuiltinCommand.Model, description: "Choose the model for this session" },
  { command: BuiltinCommand.Thinking, description: "Set the thinking level for this session" },
  { command: BuiltinCommand.New, description: "Start a new session" },
  { command: BuiltinCommand.Resume, description: "Open the session list" },
  { command: BuiltinCommand.Fork, description: "Fork from a previous message" },
  { command: BuiltinCommand.Clone, description: "Clone this session's active branch" },
  { command: BuiltinCommand.Name, description: "Set this session's display name" },
  { command: BuiltinCommand.Session, description: "Show this session's statistics" },
  { command: BuiltinCommand.Export, description: "Export this session as HTML" },
];

/**
 * The built-in whose command id is `name`, or `null`. `name` is arbitrary text the user typed after
 * a `/`, so membership is a string comparison and never an assumption.
 */
export function findBuiltinByName(name: string): BuiltinSpec | null {
  return BUILTIN_COMMANDS.find((spec) => spec.command === name) ?? null;
}

/** The slash spelling of a command name. */
export function slashName(name: string): string {
  return `/${name}`;
}

/** The one message a built-in with no wired action reports, so it is never mistaken for success. */
export function notImplementedMessage(command: BuiltinCommand): string {
  return `${slashName(command)} is not implemented yet`;
}

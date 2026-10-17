/**
 * The `!` / `!!` composer prefix and its one label source. `!` runs a command whose output enters the
 * model's context on the next prompt; `!!` runs one whose output never does. Everything user-facing
 * about the two modes lives here, so the composer's pre-send indicator and the transcript card cannot
 * disagree about what a prefix means.
 */

import type { BashExecutionBlock } from "@pi-my-ui/protocol";

/** The prefix whose output joins the model's context on the next prompt. */
export const BASH_PREFIX = "!";

/** The prefix whose output is stored but kept out of the model's context. */
export const BASH_EXCLUDE_PREFIX = "!!";

/** The two bash modes, named once. */
export const BashMode = {
  Include: "include",
  Exclude: "exclude",
} as const;

export type BashMode = (typeof BashMode)[keyof typeof BashMode];

export interface BashModePresentation {
  /** The prefix as the user typed it. */
  readonly glyph: string;
  readonly excludeFromContext: boolean;
  /** A short badge for the indicator and the card header. */
  readonly label: string;
  /** One sentence stating what happens to the output on the next prompt. */
  readonly description: string;
}

/** The one presentation for both modes; a new mode is a compile error here. */
export const BASH_MODE_PRESENTATION: Readonly<Record<BashMode, BashModePresentation>> = {
  [BashMode.Include]: {
    glyph: BASH_PREFIX,
    excludeFromContext: false,
    label: "adds to context",
    description: "The output will enter the model's context on the next prompt.",
  },
  [BashMode.Exclude]: {
    glyph: BASH_EXCLUDE_PREFIX,
    excludeFromContext: true,
    label: "not added to context",
    description: "The output will not enter the model's context.",
  },
};

/** A recognised leading prefix and the command after it. */
export interface BashPrefix {
  readonly mode: BashMode;
  /** The command with the prefix and surrounding whitespace removed; empty when nothing followed. */
  readonly command: string;
}

/**
 * Parse a leading `!`/`!!`, or `null` for text that does not start with one. A bare prefix is not
 * `null`: it is a recognised prefix with nothing to run, so the caller can refuse it rather than
 * forwarding the glyph to the model.
 */
export function parseBashPrefix(text: string): BashPrefix | null {
  if (text.startsWith(BASH_EXCLUDE_PREFIX)) {
    return { mode: BashMode.Exclude, command: text.slice(BASH_EXCLUDE_PREFIX.length).trim() };
  }
  if (text.startsWith(BASH_PREFIX)) {
    return { mode: BashMode.Include, command: text.slice(BASH_PREFIX.length).trim() };
  }
  return null;
}

/** The one message for a prefix submitted with no command. */
export function blankBashCommandMessage(mode: BashMode): string {
  return `Enter a command after ${BASH_MODE_PRESENTATION[mode].glyph}`;
}

/** A shell command carries no images, so an attached one would be dropped without ever being sent. */
export function bashAttachmentsMessage(mode: BashMode): string {
  return `${BASH_MODE_PRESENTATION[mode].glyph} does not accept image attachments`;
}

/**
 * Decide a composer submission as a shell command. `undefined` means it is not one, `null` means it
 * was accepted and handed to `run`, and a string is the message to show without sending anything.
 */
export function submitBashCommand(
  text: string,
  attachmentCount: number,
  run: (command: string, excludeFromContext: boolean) => void,
): string | null | undefined {
  const prefix = parseBashPrefix(text);
  if (prefix === null) {
    return undefined;
  }
  if (prefix.command === "") {
    return blankBashCommandMessage(prefix.mode);
  }
  if (attachmentCount > 0) {
    return bashAttachmentsMessage(prefix.mode);
  }
  run(prefix.command, BASH_MODE_PRESENTATION[prefix.mode].excludeFromContext);
  return null;
}

/** The one mapping from the wire's `excludeFromContext` back to a mode. */
export function modeForExecution(excludeFromContext: boolean): BashMode {
  return excludeFromContext ? BashMode.Exclude : BashMode.Include;
}

/** A finished command's status. A cancelled command is `aborted`, never a failure. */
export const BashStatus = {
  Running: "running",
  Ok: "ok",
  Error: "error",
  Aborted: "aborted",
} as const;

export type BashStatus = (typeof BashStatus)[keyof typeof BashStatus];

/** Derive a command's status from the projected block; the card never decides for itself. */
export function bashStatus(block: BashExecutionBlock): BashStatus {
  const result = block.result;
  if (result === undefined) {
    return BashStatus.Running;
  }
  if (result.cancelled) {
    return BashStatus.Aborted;
  }
  return result.exitCode === 0 ? BashStatus.Ok : BashStatus.Error;
}

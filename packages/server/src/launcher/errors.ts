/**
 * Typed errors for the launcher. Every failure names the offending flag so the entry point can
 * print one actionable line instead of a stack trace.
 */

import { LAUNCHER_COMMAND_NAME, LAUNCHER_USAGE } from "./flags.js";

export class LauncherError extends Error {
  public override readonly name: string = "LauncherError";

  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

/** An argument the launcher cannot act on; carries the offending flag. */
export class LauncherArgumentError extends LauncherError {
  public override readonly name = "LauncherArgumentError";

  public constructor(
    public readonly argument: string,
    message: string,
  ) {
    super(`${message}\n\n${LAUNCHER_USAGE}`);
  }
}

/** The flags are individually valid but their combination cannot be honoured. */
export class LauncherConfigurationError extends LauncherError {
  public override readonly name = "LauncherConfigurationError";

  public constructor(
    public readonly setting: string,
    message: string,
  ) {
    super(`${LAUNCHER_COMMAND_NAME}: ${message}`);
  }
}

/** The requested address could not be bound. Names the flag the user must change. */
export class LauncherBindError extends LauncherError {
  public override readonly name = "LauncherBindError";

  public constructor(
    public readonly setting: string,
    public readonly code: string,
    public readonly hostname: string,
    public readonly port: number,
    public readonly reason: string,
    options?: { readonly cause?: unknown },
  ) {
    super(
      `${LAUNCHER_COMMAND_NAME}: could not bind ${JSON.stringify(hostname)}:${String(port)}: ` +
        `${reason}; change ${setting} (${code})`,
      options,
    );
  }
}

/**
 * Typed failures for the bridge listener. The socket's path is on every one, because a caller's
 * first question about a bridge that did not come up is where the server looked for it.
 */

export class BridgeError extends Error {
  public override readonly name: string = "BridgeError";

  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

/** The bridge socket could not be created, bound, secured or removed. */
export class BridgeSocketError extends BridgeError {
  public override readonly name = "BridgeSocketError";

  public constructor(
    public readonly socketPath: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`bridge socket ${JSON.stringify(socketPath)}: ${message}`, options);
  }
}

/** The bridge cannot be configured as asked; the server refuses rather than running degraded. */
export class BridgeConfigurationError extends BridgeError {
  public override readonly name = "BridgeConfigurationError";
}

/** A Pi child never completed the handshake, so its Session cannot be served. */
export class BridgeConnectionError extends BridgeError {
  public override readonly name = "BridgeConnectionError";

  public constructor(
    public readonly sessionId: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`session ${JSON.stringify(sessionId)}: ${message}`, options);
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The one error type a protocol boundary throws. Every failure carries a closed code, so a caller
 * branches on the code instead of matching message text.
 */

/** The closed set of protocol error codes. */
export const ProtocolErrorCode = {
  /** The `type` discriminator is not one this protocol knows. */
  UnknownType: "unknownType",
  /** A field is missing, has the wrong JSON type, or is out of range. */
  MalformedPayload: "malformedPayload",
  /** The named Session is not one the server can serve. */
  UnknownSession: "unknownSession",
  /** The named Project is not one this server serves. */
  UnknownProject: "unknownProject",
  /** A Project cannot be created because the server was started with no workspace to anchor one. */
  NoWorkspace: "noWorkspace",
  /** The name cannot become a Project directory: empty, dotted, nested or not one path segment. */
  InvalidProjectName: "invalidProjectName",
  /** The name already names a registered Project, so creating it would not add one. */
  ProjectExists: "projectExists",
  /** The server failed to do what the message asked; the message itself was well-formed. */
  InternalError: "internalError",
  /** A filesystem path that escapes the served root: a security refusal, not a malformed request. */
  PathEscape: "pathEscape",
  /** A well-formed request the server refused to perform; the refusal is never success. */
  CommandFailed: "commandFailed",
} as const;

export type ProtocolErrorCode = (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode];

/** The wire form of a protocol error, carried in an `error` message. */
export interface ProtocolErrorInfo {
  readonly code: ProtocolErrorCode;
  readonly message: string;
  /** What the failure concerns — a requested path — so a client can attach it to the right node. */
  readonly detail?: string;
}

/** A typed boundary failure. Validators throw it; the transport converts it with `toInfo`. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly detail: string | undefined;

  constructor(code: ProtocolErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.detail = detail;
  }

  toInfo(): ProtocolErrorInfo {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail };
  }
}

/** True for any {@link ProtocolError}. */
export function isProtocolError(value: unknown): value is ProtocolError {
  return value instanceof ProtocolError;
}

/** Convert any thrown value into the wire form, wrapping non-protocol errors. */
export function toProtocolErrorInfo(error: unknown): ProtocolErrorInfo {
  if (error instanceof ProtocolError) {
    return error.toInfo();
  }
  if (error instanceof Error) {
    return { code: ProtocolErrorCode.InternalError, message: error.message };
  }
  return { code: ProtocolErrorCode.InternalError, message: String(error) };
}

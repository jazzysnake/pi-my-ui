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
  /** The server failed to do what the message asked; the message itself was well-formed. */
  InternalError: "internalError",
} as const;

export type ProtocolErrorCode = (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode];

/** The wire form of a protocol error, carried in an `error` message. */
export interface ProtocolErrorInfo {
  readonly code: ProtocolErrorCode;
  readonly message: string;
}

/** A typed boundary failure. Validators throw it; the transport converts it with `toInfo`. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }

  toInfo(): ProtocolErrorInfo {
    return { code: this.code, message: this.message };
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

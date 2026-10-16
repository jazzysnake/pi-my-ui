/**
 * The one trust decision for an inbound WebSocket upgrade, and the one rule for what an
 * `--allowed-origin` value may be.
 *
 * The app has no authentication and every Session carries the user's shell and working tree, so
 * network reachability is not enough: a page on another origin must not open the socket. The
 * configured allowlist is enforced here and nowhere else, and a refusal carries the origin the
 * browser sent so the operator can fix the list.
 *
 * The value rule lives here rather than in the launcher so the flag parser and the transport
 * enforcement cannot disagree about what a token means. Two WHATWG normalisations are refused
 * rather than performed silently: userinfo (`https://x@evil.example` normalises to
 * `https://evil.example`, allowing a host the operator never named) and a path/query/fragment
 * (`URL.origin` would widen the entry to its whole origin).
 */

import { isLoopbackAddress, isLoopbackHostname } from "./loopback.js";

export const ALLOWED_ORIGIN_FLAG_NAME = "allowed-origin";
export const ALLOWED_ORIGIN_FLAG = `--${ALLOWED_ORIGIN_FLAG_NAME}`;

const WILDCARD_ORIGIN = "*";
const USERINFO_MARKER = "@";
const BARE_ORIGIN_PATTERN = /^https?:\/\/[^/?#\s]+\/?$/;
const NULL_ORIGIN = "null";

/** Why an allowed-origin value was refused; each kind has exactly one message. */
export type AllowedOriginRejection =
  | { readonly kind: "wildcard" }
  | { readonly kind: "credentials" }
  | { readonly kind: "not-bare-origin" }
  | { readonly kind: "unusable"; readonly cause: unknown };

export type AllowedOriginValidation =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly rejection: AllowedOriginRejection };

/** Validate and normalise one allowed-origin value. Never throws; the caller picks the error. */
export function validateAllowedOrigin(value: string): AllowedOriginValidation {
  if (value === WILDCARD_ORIGIN) {
    return { ok: false, rejection: { kind: "wildcard" } };
  }
  if (value.includes(USERINFO_MARKER)) {
    return { ok: false, rejection: { kind: "credentials" } };
  }
  if (!BARE_ORIGIN_PATTERN.test(value)) {
    return { ok: false, rejection: { kind: "not-bare-origin" } };
  }
  try {
    return { ok: true, origin: new URL(value).origin };
  } catch (error) {
    return { ok: false, rejection: { kind: "unusable", cause: error } };
  }
}

/** The one actionable sentence for a refused value, naming the flag and what to do instead. */
export function allowedOriginError(value: string, rejection: AllowedOriginRejection): string {
  switch (rejection.kind) {
    case "wildcard":
      return `${ALLOWED_ORIGIN_FLAG} may not be a wildcard; list each origin explicitly`;
    case "credentials":
      return (
        `${ALLOWED_ORIGIN_FLAG} may not contain credentials (user@host): the credential is ` +
        `discarded and a different host would be allowed, got ${JSON.stringify(value)}`
      );
    case "not-bare-origin":
      return (
        `${ALLOWED_ORIGIN_FLAG} must be a bare origin without a path, query, fragment, or ` +
        `credentials, e.g. https://pi.example.ts.net, got ${JSON.stringify(value)}`
      );
    case "unusable":
      return (
        `${ALLOWED_ORIGIN_FLAG} is not a usable origin, got ${JSON.stringify(value)} ` +
        `(${rejection.cause instanceof Error ? rejection.cause.message : String(rejection.cause)})`
      );
  }
}

/** An allowlist entry the transport cannot enforce. Raised before anything binds. */
export class OriginConfigurationError extends Error {
  public override readonly name = "OriginConfigurationError";

  public constructor(message: string) {
    super(message);
  }
}

/** The request facts an upgrade decision needs. */
export interface OriginRequest {
  /** The `Origin` header as sent, or `undefined` when absent (some non-browser clients). */
  readonly origin: string | undefined;
  /** The socket peer address, or `undefined` when it cannot be read. */
  readonly peerAddress: string | undefined;
}

export type TrustDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** Whether an upgrade carrying `request` may proceed, and if not, why (for the log). */
export interface TrustPolicy {
  decide(request: OriginRequest): TrustDecision;
}

function refusal(reason: string): TrustDecision {
  return { allowed: false, reason };
}

/** `URL.origin` of a value, or `undefined` for an opaque/unparseable one (`Origin: null`). */
function normaliseOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.origin === NULL_ORIGIN ? undefined : url.origin;
  } catch {
    return undefined;
  }
}

function hostnameOf(value: string): string | undefined {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "" ? undefined : hostname;
  } catch {
    return undefined;
  }
}

/**
 * Build the policy from the configured allowlist, validating every entry first so an unusable
 * configuration fails before a socket opens. With no configured origin — the loopback development
 * default — no foreign origin is accepted: a browser request must carry a loopback origin and a
 * request with no `Origin` is accepted only from a loopback peer.
 */
export function createTrustPolicy(allowedOrigins: readonly string[]): TrustPolicy {
  const allowed: string[] = [];
  for (const entry of allowedOrigins) {
    const validation = validateAllowedOrigin(entry);
    if (!validation.ok) {
      throw new OriginConfigurationError(allowedOriginError(entry, validation.rejection));
    }
    allowed.push(validation.origin);
  }

  return {
    decide(request) {
      if (allowed.length > 0) {
        if (request.origin === undefined) {
          return refusal("the request carried no Origin and an allowlist is configured");
        }
        const normalised = normaliseOrigin(request.origin);
        if (normalised === undefined || !allowed.includes(normalised)) {
          return refusal(`origin ${JSON.stringify(request.origin)} is not in the allowlist`);
        }
        return { allowed: true };
      }

      if (request.origin === undefined) {
        if (!isLoopbackAddress(request.peerAddress)) {
          return refusal(
            `the request carried no Origin and peer ${JSON.stringify(request.peerAddress ?? "(unknown)")} is not loopback`,
          );
        }
        return { allowed: true };
      }

      const hostname = hostnameOf(request.origin);
      if (hostname === undefined || !isLoopbackHostname(hostname)) {
        return refusal(`origin ${JSON.stringify(request.origin)} is not loopback`);
      }
      return { allowed: true };
    },
  };
}

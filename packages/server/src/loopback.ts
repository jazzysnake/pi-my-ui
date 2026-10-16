/**
 * Loopback classification for the exposure policy, defined once. The bind guard and the origin
 * policy both need "is this the local machine", and two spellings of that question drift: one
 * accepts `127.evil.example` by prefix and the other does not. Addresses are parsed, never
 * prefix-matched.
 */

import { isIPv4, isIPv6 } from "node:net";

/** Node reports an IPv4 peer in this IPv6 form on a dual-stack socket. */
const IPV4_MAPPED_PREFIX = "::ffff:";

export function canonicalHost(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, hostname.length - 1)
      : hostname;
  return withoutBrackets.toLowerCase();
}

/** The compressed IPv6 form of an address, so `0:0:0:0:0:0:0:1` and `::1` compare equal. */
function canonicalIpv6(host: string): string | undefined {
  if (!isIPv6(host)) {
    return undefined;
  }
  try {
    return new URL(`http://[${host}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
}

/** True for a hostname that stays on the machine: `localhost`, an IPv4 `127/8`, or IPv6 `::1`. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = canonicalHost(hostname);
  if (host === "localhost") {
    return true;
  }
  if (isIPv4(host)) {
    return host.split(".")[0] === "127";
  }
  return canonicalIpv6(host) === "::1";
}

/**
 * True for a socket peer that is the local machine. A peer is always an IP literal, and Node may
 * report an IPv4 peer in its IPv4-mapped form, which is loopback but is not a usable bind host.
 * `undefined` fails closed.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  const host = address.startsWith(IPV4_MAPPED_PREFIX)
    ? address.slice(IPV4_MAPPED_PREFIX.length)
    : address;
  return isLoopbackHostname(host);
}

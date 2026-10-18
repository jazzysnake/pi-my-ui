/**
 * Where the browser points its transport and which Project and Session it opens, resolved from the
 * page URL. The `ws` override exists for a dev or test page served from a different origin than the
 * server; production serves the client and proxies the WebSocket from one origin, so the default
 * applies.
 */

/** The WebSocket route a same-origin deployment proxies to the server. */
export const WS_PATH = "/ws";

export interface ClientConfig {
  readonly wsUrl: string;
  /** The `?ws=` value when the address overrides the origin, so a rewritten address keeps it. */
  readonly wsOverride: string | null;
  /** The Project named by `?project=`, an absolute path, or `null` when the address names none. */
  readonly project: string | null;
  readonly sessionId: string | null;
}

/** The page's own origin, at {@link WS_PATH}, with the scheme the page was served over. */
export function defaultWebSocketUrl(href: string): string {
  const url = new URL(WS_PATH, href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * The page address naming a Project and, when one is open, its Session. The `ws` override survives
 * the rewrite so a dev or test page keeps reaching the server it was opened against.
 */
export function projectAddress(
  href: string,
  project: string,
  sessionId: string | null,
  wsOverride: string | null,
): string {
  const params = new URLSearchParams({ project });
  if (sessionId !== null) {
    params.set("session", sessionId);
  }
  if (wsOverride !== null) {
    params.set("ws", wsOverride);
  }
  const url = new URL(href);
  url.search = params.toString();
  return url.toString();
}

export function resolveClientConfig(href: string, search: string): ClientConfig {
  const params = new URLSearchParams(search);
  const session = params.get("session");
  const project = params.get("project");
  const wsOverride = params.get("ws");
  return {
    wsUrl: wsOverride ?? defaultWebSocketUrl(href),
    wsOverride: wsOverride === null || wsOverride === "" ? null : wsOverride,
    project: project === null || project === "" ? null : project,
    sessionId: session === null || session === "" ? null : session,
  };
}

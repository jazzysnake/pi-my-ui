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

export function resolveClientConfig(href: string, search: string): ClientConfig {
  const params = new URLSearchParams(search);
  const session = params.get("session");
  const project = params.get("project");
  return {
    wsUrl: params.get("ws") ?? defaultWebSocketUrl(href),
    project: project === null || project === "" ? null : project,
    sessionId: session === null || session === "" ? null : session,
  };
}

/**
 * The HTTP and WebSocket transport. A connection carries one Session's Snapshot at a Cursor. Every
 * inbound frame is validated at the boundary; a rejected frame is answered with a typed error and
 * never reaches the Session pool.
 *
 * The HTTP surface is deliberately tiny: `GET /healthz` and nothing else. The built client is
 * served by a static host (Caddy in production, the Vite dev server locally), so the backend stays
 * a backend.
 */

import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  ClientMessageType,
  ServerMessageType,
  parseClientMessage,
  toProtocolErrorInfo,
  type ClientMessage,
  type ServerMessage,
} from "@pi-my-ui/protocol";
import { WebSocket, WebSocketServer } from "ws";

import { DEFAULT_HOST, DEFAULT_PORT, type ServerConfig } from "./config.js";
import { handleFileDownload, isFileDownloadPath } from "./files/route.js";
import { listDirectory } from "./files/listing.js";
import { readPreview } from "./files/preview.js";
import { createTrustPolicy } from "./origin.js";
import type { SessionViewer } from "./session-host.js";
import { createSessionPool } from "./session-pool.js";
import { listSessions } from "./sessions.js";

/** Health-check route path. */
export const HEALTHZ_PATH = "/healthz";
/** Service name reported by the health endpoint. */
export const HEALTHZ_SERVICE_NAME = "pi-my-ui-server";

/** The errno recorded when a failed bind carried no OS code (never a silent success). */
export const UNKNOWN_BIND_ERROR_CODE = "UNKNOWN";

/** The requested address could not be bound, with the errno so a caller can name the flag to change. */
export class ServerBindError extends Error {
  public override readonly name = "ServerBindError";

  public constructor(
    public readonly code: string,
    public readonly hostname: string,
    public readonly port: number,
    options?: { readonly cause?: unknown },
  ) {
    super(`could not bind ${JSON.stringify(hostname)}:${String(port)} (${code})`, options);
  }
}

function errnoCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") {
      return code;
    }
  }
  return UNKNOWN_BIND_ERROR_CODE;
}

/** The one Session a socket has attached to, so a later frame can detach it on close. */
interface SocketAttachment {
  detach: (() => void) | undefined;
}

export interface RunningServer {
  /** The WebSocket URL a browser connects to. */
  readonly url: string;
  /** The HTTP origin, for the health endpoint and any same-origin route. */
  readonly httpUrl: string;
  readonly port: number;
  /**
   * Terminate every attached viewer socket without stopping the server; the Sessions keep running.
   * Test-only, so a spec can exercise a viewer's reconnect and resync against the real transport.
   */
  dropViewerConnections(): number;
  close(): Promise<void>;
}

function healthBody(): string {
  return JSON.stringify({ status: "ok", service: HEALTHZ_SERVICE_NAME });
}

function pathnameOf(url: string | undefined): string {
  return new URL(url ?? "/", "http://localhost").pathname;
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const bindHost = config.host ?? DEFAULT_HOST;
  const bindPort = config.port ?? DEFAULT_PORT;
  const log =
    config.log ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
  const trust = createTrustPolicy(config.allowedOrigins ?? []);
  const pool = createSessionPool(config);

  const httpServer = createHttpServer((request, response) => {
    const pathname = pathnameOf(request.url);
    if (pathname === HEALTHZ_PATH) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(healthBody());
      return;
    }
    if (isFileDownloadPath(pathname)) {
      handleFileDownload(request, response, { cwd: config.cwd, trust, log });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const sockets = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const rawOrigin = request.headers.origin;
    const origin = rawOrigin === undefined || rawOrigin === "" ? undefined : rawOrigin;
    const decision = trust.decide({ origin, peerAddress: request.socket.remoteAddress });
    if (!decision.allowed) {
      log(`refused WebSocket upgrade: ${decision.reason}`);
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  });

  function send(socket: WebSocket, message: ServerMessage): void {
    // A browser can disconnect while its Snapshot is being built; writing to a closed socket would
    // throw out of a detached handler.
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  async function handle(
    socket: WebSocket,
    attachment: SocketAttachment,
    frame: string,
  ): Promise<void> {
    let message: ClientMessage;
    try {
      message = parseClientMessage(frame);
    } catch (error) {
      send(socket, { type: ServerMessageType.Error, error: toProtocolErrorInfo(error) });
      return;
    }
    const viewer: SessionViewer = { onMessage: (outbound) => send(socket, outbound) };
    const nameSession =
      "sessionId" in message && typeof message.sessionId === "string"
        ? { sessionId: message.sessionId }
        : {};
    try {
      // The list is disk facts about the working directory, not a Session, so it is answered here
      // rather than by a Session host; no Pi child starts to produce it.
      if (message.type === ClientMessageType.ListSessions) {
        send(socket, {
          type: ServerMessageType.Sessions,
          sessions: await listSessions(config.cwd, config.sessionDir),
        });
        return;
      }
      // The file capability reads the server's working directory, not a Session, so it is answered
      // here rather than by a Session host.
      if (message.type === ClientMessageType.ListDirectory) {
        send(socket, {
          type: ServerMessageType.DirectoryListing,
          ...listDirectory(config.cwd, message.path),
        });
        return;
      }
      if (message.type === ClientMessageType.PreviewFile) {
        send(socket, {
          type: ServerMessageType.FilePreview,
          ...readPreview(config.cwd, message.path),
        });
        return;
      }
      const host = await pool.hostFor(message.sessionId);
      if (message.type === ClientMessageType.Subscribe) {
        attachment.detach?.();
        attachment.detach = await host.attach(viewer, message.cursor);
        return;
      }
      if (message.type === ClientMessageType.Prompt) {
        await host.prompt(message.text, message.images ?? [], message.streamingBehavior);
        return;
      }
      if (message.type === ClientMessageType.SetModel) {
        await host.setModel(message.provider, message.modelId);
        return;
      }
      if (message.type === ClientMessageType.SetThinkingLevel) {
        await host.setThinkingLevel(message.level);
        return;
      }
      if (message.type === ClientMessageType.SetAutoCompaction) {
        await host.setAutoCompaction(message.enabled);
        return;
      }
      await host.abort();
    } catch (error) {
      // The failure is tagged with the Session it concerns so the composer can show it against the
      // message it refused rather than dropping it on the floor.
      send(socket, {
        type: ServerMessageType.Error,
        error: toProtocolErrorInfo(error),
        ...nameSession,
      });
    }
  }

  sockets.on("connection", (socket) => {
    const attachment: SocketAttachment = { detach: undefined };
    socket.on("close", () => {
      attachment.detach?.();
      attachment.detach = undefined;
    });
    socket.on("message", (data) => {
      void handle(socket, attachment, data.toString());
    });
  });

  await new Promise<void>((resolve, reject) => {
    // A failed `listen` emits `error`; without a listener Node aborts with a raw stack trace.
    const onError = (error: Error): void => {
      reject(new ServerBindError(errnoCode(error), bindHost, bindPort, { cause: error }));
    };
    httpServer.once("error", onError);
    httpServer.listen(bindPort, bindHost, () => {
      httpServer.off("error", onError);
      resolve();
    });
  });
  const address = httpServer.address() as AddressInfo;
  const boundPort = address.port;

  return {
    url: `ws://${bindHost}:${String(boundPort)}`,
    httpUrl: `http://${bindHost}:${String(boundPort)}`,
    port: boundPort,
    dropViewerConnections() {
      const dropped = sockets.clients.size;
      for (const client of sockets.clients) {
        client.terminate();
      }
      return dropped;
    },
    async close() {
      for (const client of sockets.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => {
        sockets.close(() => {
          resolve();
        });
      });
      await pool.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

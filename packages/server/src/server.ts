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
  SessionMutation,
  parseClientMessage,
  toProtocolErrorInfo,
  type ClientMessage,
  type ServerMessage,
  type SessionRef,
} from "@pi-my-ui/protocol";
import { WebSocket, WebSocketServer } from "ws";

import { DEFAULT_HOST, DEFAULT_PORT, type ServerConfig } from "./config.js";
import { BridgeError } from "./bridge/errors.js";
import { startBridgeListener, type BridgeListener } from "./bridge/listener.js";
import { bridgeSocketPath } from "./bridge/socket-path.js";
import { handleFileDownload, isFileDownloadPath } from "./files/route.js";
import { listDirectory } from "./files/listing.js";
import { readPreview } from "./files/preview.js";
import { createTrustPolicy } from "./origin.js";
import { createProjectRegistry } from "./projects.js";
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

/**
 * The one Session a socket is attached to, so a later frame can detach it on close. `generation`
 * identifies the subscription a detach belongs to: subscribing twice before the first attach has
 * finished would otherwise latch a detach nobody calls and leave that Session watched for good.
 */
interface SocketAttachment {
  detach: (() => void) | undefined;
  generation: number;
  /** The Project whose list this connection watches, set by answering its `listSessions`. */
  watchedProject: string | null;
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
  const registry = createProjectRegistry(config.projects);

  const httpServer = createHttpServer((request, response) => {
    const pathname = pathnameOf(request.url);
    if (pathname === HEALTHZ_PATH) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(healthBody());
      return;
    }
    if (isFileDownloadPath(pathname)) {
      handleFileDownload(request, response, { project: registry.primary, trust, log });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const sockets = new WebSocketServer({ noServer: true });

  function send(socket: WebSocket, message: ServerMessage): void {
    // A browser can disconnect while its Snapshot is being built; writing to a closed socket would
    // throw out of a detached handler.
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

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

  const socketPath = config.bridge?.socketPath ?? bridgeSocketPath(boundPort, process.env);
  let bridge: BridgeListener;
  try {
    bridge = await startBridgeListener({
      socketPath,
      ...(config.bridge?.connectTimeoutMs === undefined
        ? {}
        : { connectTimeoutMs: config.bridge.connectTimeoutMs }),
      log,
    });
  } catch (error) {
    // A server without its bridge is not a usable server, so a socket that cannot be bound is
    // reported rather than papered over.
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
    throw error;
  }
  /** The attachment of every connected socket, so a push can reach only its Project's watchers. */
  const attachments = new Map<WebSocket, SocketAttachment>();

  // The pool is created once the bound port is known, because the bridge socket's default path is
  // derived from it, and it is created before any connection is accepted.
  const pool = createSessionPool(
    config,
    {
      socketPath,
      ...(config.bridge?.extensionEntry === undefined
        ? {}
        : { extensionEntry: config.bridge.extensionEntry }),
      gate: bridge,
    },
    // A Session starting, settling or retrying changes a row's live state, so the viewers watching
    // that Project get a fresh list. The push is serialized below, so quick transitions stay ordered.
    { onActivity: (session) => scheduleSessionsPush(session.project) },
    registry,
  );

  let sessionsPush: Promise<void> = Promise.resolve();

  /** Send one Project's list and live activity to the connections watching it, one push at a time. */
  function scheduleSessionsPush(project: string): void {
    sessionsPush = sessionsPush
      .then(async () => {
        const message: ServerMessage = {
          type: ServerMessageType.Sessions,
          project,
          sessions: await listSessions(project, config.sessionDir),
          activity: pool.activityById(project),
        };
        for (const [client, attachment] of attachments) {
          if (attachment.watchedProject === project) {
            send(client, message);
          }
        }
      })
      .catch(() => undefined);
  }

  /** Drop the currently watched Session, so a connection can move to another Project's list. */
  function detachWatchedSession(attachment: SocketAttachment): void {
    attachment.detach?.();
    attachment.detach = undefined;
    attachment.generation += 1;
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
    const named: SessionRef | undefined = "session" in message ? message.session : undefined;
    try {
      // The list is disk facts about the working directory, not a Session, so it is answered here
      // rather than by a Session host; no Pi child starts to produce it.
      if (message.type === ClientMessageType.ListProjects) {
        send(socket, { type: ServerMessageType.Projects, projects: registry.projects });
        return;
      }
      if (message.type === ClientMessageType.ListSessions) {
        const project = registry.require(message.project);
        if (attachment.watchedProject !== project) {
          // One connection watches one Project's list, so the Session it was watching belongs to the
          // view it is leaving.
          detachWatchedSession(attachment);
          attachment.watchedProject = project;
        }
        send(socket, {
          type: ServerMessageType.Sessions,
          project,
          sessions: await listSessions(project, config.sessionDir),
          activity: pool.activityById(project),
        });
        return;
      }
      // A fresh Session has a server-generated id and no file yet, so the client is told the pair
      // and opens it; the child pi starts names its own file from that id.
      if (message.type === ClientMessageType.CreateSession) {
        const project = registry.require(message.project);
        const host = pool.create(project);
        send(socket, { type: ServerMessageType.SessionCreated, session: host.session });
        scheduleSessionsPush(project);
        return;
      }
      // The file capability reads the server's working directory, not a Session, so it is answered
      // here rather than by a Session host.
      if (message.type === ClientMessageType.ListDirectory) {
        send(socket, {
          type: ServerMessageType.DirectoryListing,
          ...listDirectory(registry.primary, message.path),
        });
        return;
      }
      if (message.type === ClientMessageType.PreviewFile) {
        send(socket, {
          type: ServerMessageType.FilePreview,
          ...readPreview(registry.primary, message.path),
        });
        return;
      }
      if (
        message.type === ClientMessageType.Subscribe ||
        message.type === ClientMessageType.Prompt ||
        message.type === ClientMessageType.Abort
      ) {
        if (attachment.watchedProject !== message.session.project) {
          detachWatchedSession(attachment);
          attachment.watchedProject = message.session.project;
        }
        const host = await pool.hostFor(message.session);
        if (message.type === ClientMessageType.Subscribe) {
          // A connection watches one Session, so subscribing elsewhere releases the one it had.
          detachWatchedSession(attachment);
          const generation = attachment.generation;
          const detach = await host.attach(viewer, message.cursor);
          // A browser can close its socket, or subscribe somewhere else, while its Snapshot is still
          // being built. A detach that is latched after that would never be called, and the Session
          // it belongs to stays watched, so it is never evicted: nothing can reclaim it.
          if (attachment.generation !== generation || socket.readyState !== WebSocket.OPEN) {
            detach();
            return;
          }
          attachment.detach = detach;
          return;
        }
        if (message.type === ClientMessageType.Prompt) {
          await host.prompt(message.text, message.images ?? [], message.streamingBehavior);
          return;
        }
        await host.abort();
        return;
      }
      const host = await pool.hostFor(message.session);
      if (message.type === ClientMessageType.SteerSubagent) {
        await host.steerSubagent(message.agentId, message.message);
        return;
      }
      if (message.type === ClientMessageType.GetSubagentTranscript) {
        send(socket, {
          type: ServerMessageType.SubagentTranscript,
          session: message.session,
          agentId: message.agentId,
          ...(await host.subagentTranscript(message.agentId)),
        });
        return;
      }
      if (message.type === ClientMessageType.Bash) {
        await host.bash(message.command, message.excludeFromContext);
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
      if (message.type === ClientMessageType.Compact) {
        await host.compact(message.customInstructions);
        return;
      }
      if (message.type === ClientMessageType.GetSessionStats) {
        send(socket, {
          type: ServerMessageType.SessionStats,
          session: message.session,
          stats: await host.sessionStats(),
        });
        return;
      }
      if (message.type === ClientMessageType.SetSessionName) {
        await host.setSessionName(message.name);
        send(socket, {
          type: ServerMessageType.SessionRenamed,
          session: message.session,
          name: message.name,
        });
        // The name is disk state the drawer reads, so the list is re-read and pushed to that
        // Project's watchers.
        scheduleSessionsPush(host.session.project);
        return;
      }
      if (message.type === ClientMessageType.ExportSession) {
        send(socket, {
          type: ServerMessageType.SessionExported,
          session: message.session,
          path: await host.exportHtml(),
        });
        return;
      }
      if (message.type === ClientMessageType.GetForkMessages) {
        send(socket, {
          type: ServerMessageType.ForkMessages,
          session: message.session,
          messages: await host.forkMessages(),
        });
        return;
      }
      if (
        message.type === ClientMessageType.ForkSession ||
        message.type === ClientMessageType.CloneSession
      ) {
        const outcome =
          message.type === ClientMessageType.ForkSession
            ? await host.forkSession(message.entryId)
            : await host.cloneSession();
        send(socket, {
          type: ServerMessageType.SessionForked,
          sourceSession: message.session,
          mutation:
            message.type === ClientMessageType.ForkSession
              ? SessionMutation.Fork
              : SessionMutation.Clone,
          ...(outcome.kind === "created"
            ? { session: { project: host.session.project, id: outcome.sessionId } }
            : {}),
        });
        // The mutation wrote a Session file, so that Project's watchers have a row they do not know.
        scheduleSessionsPush(host.session.project);
        return;
      }
      if (message.type === ClientMessageType.GetTree) {
        send(socket, {
          type: ServerMessageType.SessionTree,
          session: message.session,
          tree: await host.tree(),
        });
        return;
      }
      if (message.type === ClientMessageType.MoveLeaf) {
        // The host reseeds the Projection and hands every viewer a fresh Snapshot before this answer
        // goes out, so the transcript follows the new path before the move is reported as done.
        const move = await host.moveLeaf(message.entryId);
        send(socket, {
          type: ServerMessageType.LeafMoved,
          session: message.session,
          ...move,
        });
        return;
      }
      if (message.type === ClientMessageType.Reconnect) {
        // The host answers with a fresh Snapshot to every viewer of the Session, so the request needs
        // no reply of its own: the browser's Starting row ends when the Projection arrives.
        await host.reconnect();
        return;
      }
    } catch (error) {
      // A bridge that is missing or silent is a server fault the owner must see, not just a browser
      // that happens to be watching.
      if (error instanceof BridgeError) {
        log(`bridge: ${error.message}`);
      }
      // The failure is tagged with the Session it concerns so the composer can show it against the
      // message it refused rather than dropping it on the floor.
      send(socket, {
        type: ServerMessageType.Error,
        error: toProtocolErrorInfo(error),
        ...(named === undefined ? {} : { session: named }),
      });
    }
  }

  // Registered only once the pool exists: an upgrade that arrives before the server is ready is
  // dropped by Node (and the browser reconnects) instead of being accepted with nowhere to route it.
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

  sockets.on("connection", (socket) => {
    const attachment: SocketAttachment = {
      detach: undefined,
      generation: 0,
      watchedProject: null,
    };
    attachments.set(socket, attachment);
    socket.on("close", () => {
      attachments.delete(socket);
      attachment.detach?.();
      attachment.detach = undefined;
    });
    socket.on("message", (data) => {
      void handle(socket, attachment, data.toString());
    });
  });

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
      await bridge.close();
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

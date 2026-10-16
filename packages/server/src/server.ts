/**
 * The WebSocket transport. A connection carries one Session's Snapshot at a Cursor. Every inbound
 * frame is validated at the boundary; a rejected frame is answered with a typed error and never
 * reaches the Session pool.
 */

import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  ServerMessageType,
  parseClientMessage,
  toProtocolErrorInfo,
  type ServerMessage,
} from "@pi-my-ui/protocol";
import { WebSocket, WebSocketServer } from "ws";

import { DEFAULT_HOST, DEFAULT_PORT, type ServerConfig } from "./config.js";
import { createSessionPool } from "./session-pool.js";

export interface RunningServer {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const bindHost = config.host ?? DEFAULT_HOST;
  const pool = createSessionPool(config);
  const httpServer = createHttpServer();
  const sockets = new WebSocketServer({ server: httpServer });

  function send(socket: WebSocket, message: ServerMessage): void {
    // A browser can disconnect while its Snapshot is being built; writing to a closed socket would
    // throw out of a detached handler.
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  async function handle(socket: WebSocket, frame: string): Promise<void> {
    let sessionId: string;
    try {
      sessionId = parseClientMessage(frame).sessionId;
    } catch (error) {
      send(socket, { type: ServerMessageType.Error, error: toProtocolErrorInfo(error) });
      return;
    }
    try {
      const host = await pool.hostFor(sessionId);
      send(socket, await host.snapshot());
    } catch (error) {
      send(socket, { type: ServerMessageType.Error, error: toProtocolErrorInfo(error) });
    }
  }

  sockets.on("connection", (socket) => {
    socket.on("message", (data) => {
      void handle(socket, data.toString());
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port ?? DEFAULT_PORT, bindHost, resolve);
  });
  const address = httpServer.address() as AddressInfo;

  return {
    url: `ws://${bindHost}:${address.port}`,
    port: address.port,
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

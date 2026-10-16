/**
 * A promise-based WebSocket client for the protocol spec. It is the real browser WebSocket talking
 * to the real server: the tests assert on what a page would receive, so nothing stands in for the
 * transport (ADR 0005).
 */

import type { ServerMessage } from "@pi-my-ui/protocol";

const DEFAULT_MESSAGE_TIMEOUT_MS = 30_000;

export interface WsSessionClient {
  /** Send a JSON message. Used for well-formed and unknown message bodies alike. */
  send(message: unknown): void;
  /** Send raw frame text, for a frame that is not JSON at all. */
  sendRaw(text: string): void;
  /** The next server message, in arrival order. */
  next(timeoutMs?: number): Promise<ServerMessage>;
  close(): Promise<void>;
}

export async function connectWsSession(url: string): Promise<WsSessionClient> {
  const socket = new WebSocket(url);
  const inbox: ServerMessage[] = [];
  const waiters: Array<(message: ServerMessage) => void> = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter === undefined) {
      inbox.push(message);
    } else {
      waiter(message);
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve();
    });
    socket.addEventListener(
      "error",
      () => {
        reject(new Error(`could not open a WebSocket to ${url}`));
      },
      { once: true },
    );
  });

  return {
    send(message) {
      socket.send(JSON.stringify(message));
    },
    sendRaw(text) {
      socket.send(text);
    },
    next(timeoutMs = DEFAULT_MESSAGE_TIMEOUT_MS) {
      const queued = inbox.shift();
      if (queued !== undefined) {
        return Promise.resolve(queued);
      }
      return new Promise<ServerMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("timed out waiting for a server message"));
        }, timeoutMs);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        socket.addEventListener("close", () => {
          resolve();
        });
        socket.close();
      });
    },
  };
}

/**
 * The one module that opens a WebSocket. It owns the socket, the subscribe handshake and the link
 * status; every decoded frame is handed to the consumer unchanged, so the store sees plain
 * `ServerMessage` values and never the transport (ADR 0005).
 */

import { ClientMessageType, type ClientMessage, type ServerMessage } from "@pi-my-ui/protocol";

/** The link states the top-bar dot renders. */
export const ConnectionStatus = {
  /** A socket is opening and the subscribe handshake has not been sent yet. */
  Connecting: "connecting",
  /** The socket is open and the subscribe handshake has been sent. */
  Connected: "connected",
  /** A live link was lost. */
  Reconnecting: "reconnecting",
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

export interface TransportHandlers {
  onStatus(status: ConnectionStatus): void;
  onMessage(message: ServerMessage): void;
}

export interface TransportOptions {
  readonly url: string;
  readonly sessionId: string;
  readonly handlers: TransportHandlers;
}

export interface Transport {
  start(): void;
  stop(): void;
  /** Send one message to the Session's Pi child. Ignored while the link is down. */
  prompt(text: string): void;
  /** Cancel the Session's running turn. Ignored while the link is down. */
  abort(): void;
}

export function createTransport(options: TransportOptions): Transport {
  let socket: WebSocket | null = null;

  function send(message: ClientMessage): void {
    const current = socket;
    if (current !== null && current.readyState === WebSocket.OPEN) {
      current.send(JSON.stringify(message));
    }
  }

  function open(): void {
    options.handlers.onStatus(ConnectionStatus.Connecting);
    const connecting = new WebSocket(options.url);
    socket = connecting;

    connecting.addEventListener("open", () => {
      const subscribe: ClientMessage = {
        type: ClientMessageType.Subscribe,
        sessionId: options.sessionId,
      };
      connecting.send(JSON.stringify(subscribe));
      options.handlers.onStatus(ConnectionStatus.Connected);
    });

    connecting.addEventListener("message", (event) => {
      options.handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage);
    });
  }

  return {
    start: open,
    stop() {
      socket?.close();
      socket = null;
    },
    prompt(text) {
      send({ type: ClientMessageType.Prompt, sessionId: options.sessionId, text });
    },
    abort() {
      send({ type: ClientMessageType.Abort, sessionId: options.sessionId });
    },
  };
}

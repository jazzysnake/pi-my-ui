/**
 * The bridge's socket client: one per Pi child, owned by the extension for the life of the session.
 *
 * It connects, sends its `hello`, and waits for the server's `helloAck`. A socket-level failure is
 * retried on a bounded schedule so a child that starts a moment before its server appears still
 * connects; a refused or unreadable handshake disables the client for good, because retrying against
 * a peer that cannot answer cannot help.
 *
 * Nothing here touches the pi session. A bridge that cannot connect is the server's loud failure to
 * report, never a reason to disturb the conversation.
 */

import { createConnection, type Socket } from "node:net";

import {
  BridgeRecordType,
  encodeBridgeRecord,
  parseBridgeHelloAck,
  type BridgeChildRecord,
  type BridgeHelloAckRecord,
} from "@pi-my-ui/protocol";

export const BRIDGE_LOG_PREFIX = "[pi-my-ui bridge]";

/** Bounded reconnect backoff, in milliseconds; the schedule is exhausted rather than retried forever. */
export const BRIDGE_RECONNECT_DELAYS_MS: readonly number[] = [50, 100, 250, 500, 1_000];

/** How long one connect plus `helloAck` round trip may take before it counts as a failed attempt. */
export const BRIDGE_HANDSHAKE_TIMEOUT_MS = 2_000;

/**
 * How many records may wait for the handshake. Only the connect window queues, so this bound is
 * reached only by a peer that never answers; dropping the oldest keeps the newest agent state and
 * reports the loss instead of growing without limit.
 */
export const BRIDGE_MAX_QUEUED_RECORDS = 256;

export type BridgeLog = (line: string) => void;
export type CancelSchedule = () => void;

export interface BridgeClientOptions {
  readonly socketPath: string;
  readonly sessionId: string;
  readonly pid: number;
  readonly log: BridgeLog;
}

export class BridgeClient {
  readonly #socketPath: string;
  readonly #sessionId: string;
  readonly #pid: number;
  readonly #log: BridgeLog;
  #socket: Socket | undefined;
  #buffer = "";
  #attempt = 0;
  #stopped = false;
  #disabled = false;
  #handshakeDone = false;
  #queue: BridgeChildRecord[] = [];
  #cancelHandshake: CancelSchedule | undefined;
  #cancelReconnect: CancelSchedule | undefined;

  public constructor(options: BridgeClientOptions) {
    this.#socketPath = options.socketPath;
    this.#sessionId = options.sessionId;
    this.#pid = options.pid;
    this.#log = options.log;
  }

  /** Begin connecting. Synchronous and non-blocking; safe to call once per session start. */
  public start(): void {
    if (this.#stopped || this.#disabled) {
      return;
    }
    this.#open();
  }

  /** Stop for good: cancel timers, close the socket, and refuse to reconnect. */
  public stop(): void {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#cancelTimers();
    this.#queue = [];
    this.#socket?.destroy();
    this.#socket = undefined;
  }

  /**
   * Send one post-handshake record. A record produced before the server's `helloAck` waits in a
   * bounded queue: an agent that appears the instant a Session starts must not be lost because the
   * handshake was a millisecond late.
   */
  public send(record: BridgeChildRecord): void {
    if (this.#stopped || this.#disabled) {
      return;
    }
    if (this.#queue.length >= BRIDGE_MAX_QUEUED_RECORDS) {
      const dropped = this.#queue.shift();
      this.#log(
        `${BRIDGE_LOG_PREFIX} dropping a queued ${dropped?.type ?? "record"} record after ` +
          `${String(BRIDGE_MAX_QUEUED_RECORDS)} unacknowledged records`,
      );
    }
    this.#queue.push(record);
    this.#flush();
  }

  #flush(): void {
    const socket = this.#socket;
    if (!this.#handshakeDone || socket === undefined || socket.destroyed) {
      return;
    }
    for (const record of this.#queue) {
      socket.write(encodeBridgeRecord(record));
    }
    this.#queue = [];
  }

  #open(): void {
    this.#buffer = "";
    this.#handshakeDone = false;
    let socket: Socket;
    try {
      socket = createConnection({ path: this.#socketPath });
    } catch (error) {
      this.#log(`${BRIDGE_LOG_PREFIX} cannot connect to ${this.#socketPath}: ${errorText(error)}`);
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      this.#onConnect(socket);
    });
    socket.on("data", (chunk: string) => {
      this.#onData(socket, chunk);
    });
    socket.on("error", (error: Error) => {
      this.#log(`${BRIDGE_LOG_PREFIX} socket error: ${error.message}`);
    });
    socket.on("close", () => {
      this.#onClose(socket);
    });
  }

  #onConnect(socket: Socket): void {
    if (socket !== this.#socket) {
      return;
    }
    socket.write(
      encodeBridgeRecord({
        type: BridgeRecordType.Hello,
        sessionId: this.#sessionId,
        pid: this.#pid,
      }),
    );
    this.#cancelHandshake = schedule(BRIDGE_HANDSHAKE_TIMEOUT_MS, () => {
      this.#cancelHandshake = undefined;
      this.#log(
        `${BRIDGE_LOG_PREFIX} no helloAck within ${String(BRIDGE_HANDSHAKE_TIMEOUT_MS)}ms; retrying`,
      );
      socket.destroy();
    });
  }

  #onData(socket: Socket, chunk: string): void {
    if (socket !== this.#socket) {
      return;
    }
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.trim() !== "") {
        this.#handleLine(line);
      }
      newline = this.#buffer.indexOf("\n");
    }
  }

  #handleLine(line: string): void {
    let ack: BridgeHelloAckRecord;
    try {
      ack = parseBridgeHelloAck(JSON.parse(line));
    } catch (error) {
      this.#disable(`invalid handshake reply: ${errorText(error)}`);
      return;
    }
    if (!ack.ok) {
      const detail =
        ack.error === undefined ? "no reason given" : `${ack.error.code}: ${ack.error.message}`;
      this.#disable(`the server refused the handshake (${detail})`);
      return;
    }
    this.#cancelHandshake?.();
    this.#cancelHandshake = undefined;
    this.#attempt = 0;
    this.#handshakeDone = true;
    this.#log(
      `${BRIDGE_LOG_PREFIX} connected to ${this.#socketPath} as session ${this.#sessionId}`,
    );
    this.#flush();
  }

  #onClose(socket: Socket): void {
    if (socket !== this.#socket) {
      return;
    }
    this.#socket = undefined;
    this.#handshakeDone = false;
    this.#cancelHandshake?.();
    this.#cancelHandshake = undefined;
    if (this.#stopped || this.#disabled) {
      return;
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#disabled) {
      return;
    }
    const delay = BRIDGE_RECONNECT_DELAYS_MS[this.#attempt];
    if (delay === undefined) {
      this.#disabled = true;
      this.#log(
        `${BRIDGE_LOG_PREFIX} giving up after ${String(BRIDGE_RECONNECT_DELAYS_MS.length)} ` +
          `reconnect attempts; the server never answered`,
      );
      return;
    }
    this.#attempt += 1;
    this.#cancelReconnect = schedule(delay, () => {
      this.#cancelReconnect = undefined;
      this.#open();
    });
  }

  #disable(reason: string): void {
    this.#disabled = true;
    this.#handshakeDone = false;
    this.#queue = [];
    this.#cancelTimers();
    this.#socket?.destroy();
    this.#socket = undefined;
    this.#log(`${BRIDGE_LOG_PREFIX} disabling the bridge for this session: ${reason}`);
  }

  #cancelTimers(): void {
    this.#cancelHandshake?.();
    this.#cancelHandshake = undefined;
    this.#cancelReconnect?.();
    this.#cancelReconnect = undefined;
  }
}

/** One unref'd timer, so a pending reconnect never holds the pi process open. */
function schedule(delayMs: number, callback: () => void): CancelSchedule {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

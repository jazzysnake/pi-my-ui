/**
 * One Session as the server holds it: a lazily started Pi child, the live Projection built from its
 * events, and the viewers that receive the Projection's Deltas. A child is addressed either by the
 * Session file it opens or by a fresh server-generated id, so no two children can write one file.
 */

import {
  ServerMessageType,
  SessionActivity,
  sessionActivityOf,
  type Cursor,
  type DeltaMessage,
  type ImageAttachment,
  type ProjectionDelta,
  type ServerMessage,
  type SettingsMessage,
  type SnapshotMessage,
  type StreamingBehavior,
  type ThinkingLevel,
} from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ServerClock } from "./clock.js";
import {
  startPiChild,
  type PiChild,
  type PiChildLaunch,
  type PiSessionTarget,
  type PiSettings,
} from "./pi-child.js";
import { createSessionProjectionMachine } from "./session-projection.js";

/** A recipient of one Session's Snapshot and Deltas; the connection implements it over its socket. */
export interface SessionViewer {
  onMessage(message: ServerMessage): void;
}

export interface SessionHost {
  readonly sessionId: string;
  /** Whether this Session's run is working, as its row shows it. */
  readonly activity: SessionActivity;
  /**
   * Deliver what a viewer missed: the Deltas after `from` when that Cursor is still retained, a
   * fresh Snapshot when it is not, and a Snapshot when the viewer has no Cursor. Returns a detach.
   */
  attach(viewer: SessionViewer, from?: Cursor): Promise<() => void>;
  prompt(
    text: string,
    images: readonly ImageAttachment[],
    behavior?: StreamingBehavior,
  ): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  close(): Promise<void>;
}

/** The bridge a Session's Pi child must connect before the Session is served. */
export interface BridgeGate {
  waitForSession(sessionId: string): Promise<void>;
}

export interface SessionHostOptions {
  readonly sessionId: string;
  /** Which Session the Pi child opens: a file the pool resolved, or a fresh server-generated id. */
  readonly target: PiSessionTarget;
  readonly launch: PiChildLaunch;
  readonly bridge: BridgeGate;
  readonly clock: ServerClock;
  /** Called once per working-state change, so a server can refresh every viewer's Session list. */
  readonly onActivity?: ((sessionId: string, activity: SessionActivity) => void) | undefined;
}

/** One published Delta batch, kept so a reconnecting viewer can replay what it missed. */
interface RetainedBatch {
  readonly message: DeltaMessage;
  readonly publishedAt: number;
}

/** Batches retained per Session; the oldest is dropped past this, falling a viewer back to a Snapshot. */
const MAX_RETAINED_BATCHES = 2048;
/** Age bound on the retained batches, so an unwatched Session does not hold Deltas indefinitely. */
const DELTA_HISTORY_TTL_MS = 5 * 60_000;

export function createSessionHost(options: SessionHostOptions): SessionHost {
  const machine = createSessionProjectionMachine(options.sessionId, options.launch.cwd);
  const viewers = new Set<SessionViewer>();
  let starting: Promise<PiChild> | undefined;
  let unsubscribe: (() => void) | undefined;
  let seeding: Promise<void> | undefined;
  let seeded = false;
  let cursor = 0;
  const history: RetainedBatch[] = [];
  /**
   * Last working state reported upward, so a text-only Delta never triggers a list refresh. It
   * starts idle because seeding only fills entries, so a freshly attached Session has no change to
   * report and must not cost every viewer a list refresh.
   */
  let reportedActivity: SessionActivity = SessionActivity.Idle;
  /** Events delivered while the seed reads pi; applied once the Projection exists, never dropped. */
  let buffering: JsonAgentSessionEvent[] | null = null;

  /** Report the current working state when it changed, and only then. */
  function reportActivity(): void {
    const activity = sessionActivityOf(machine.projection.runState);
    if (activity === reportedActivity) {
      return;
    }
    reportedActivity = activity;
    options.onActivity?.(options.sessionId, activity);
  }

  /** Drop batches past either bound from the front, so the retained window is always the newest. */
  function retain(message: DeltaMessage): void {
    history.push({ message, publishedAt: options.clock.now() });
    for (;;) {
      const oldest = history[0];
      if (oldest === undefined) {
        return;
      }
      const tooMany = history.length > MAX_RETAINED_BATCHES;
      const tooOld = options.clock.now() - oldest.publishedAt > DELTA_HISTORY_TTL_MS;
      if (!tooMany && !tooOld) {
        return;
      }
      history.shift();
    }
  }

  function publish(deltas: readonly ProjectionDelta[]): void {
    if (deltas.length === 0 || !seeded) {
      return;
    }
    const from = cursor;
    cursor += deltas.length;
    const message: DeltaMessage = {
      type: ServerMessageType.Delta,
      sessionId: options.sessionId,
      fromCursor: from,
      cursor,
      deltas,
    };
    retain(message);
    reportActivity();
    for (const viewer of [...viewers]) {
      viewer.onMessage(message);
    }
  }

  /**
   * The messages a viewer at `from` is owed, or `undefined` when the server must send a Snapshot
   * instead. Every retained Cursor between the oldest batch's start and the current one is a batch
   * boundary, so a value in that range bridges; anything else is unknown.
   */
  function missedFrom(from: Cursor | undefined): readonly ServerMessage[] | undefined {
    if (from === undefined) {
      return undefined;
    }
    const oldest = history[0];
    if (oldest === undefined) {
      return from === cursor ? [] : undefined;
    }
    if (from < oldest.message.fromCursor || from > cursor) {
      return undefined;
    }
    return history
      .filter((retained) => retained.message.cursor > from)
      .map((retained) => retained.message);
  }

  function onEvent(event: JsonAgentSessionEvent): void {
    if (buffering !== null) {
      buffering.push(event);
      return;
    }
    publish(machine.applyEvent(event));
  }

  function ensureChild(): Promise<PiChild> {
    // A child that failed to start must not be remembered: the next request retries rather than
    // replaying the first failure for the life of the server.
    starting ??= startPiChild(options.target, options.launch)
      .then((pi) => {
        unsubscribe = pi.onEvent(onEvent);
        return pi;
      })
      .catch((error: unknown) => {
        starting = undefined;
        throw error;
      });
    return starting;
  }

  async function doSeed(): Promise<void> {
    buffering = [];
    // Registered before the child starts: the extension connects on its own session start, which can
    // beat the first read from pi, and a handshake that arrives early must not be refused.
    const bridgeReady = options.bridge.waitForSession(options.sessionId);
    void bridgeReady.catch(() => undefined);
    try {
      const pi = await ensureChild();
      await bridgeReady;
      const { entries, leafId } = await pi.entries();
      cursor = machine.seed(entries, leafId);
      seeded = true;
      reportActivity();
    } finally {
      const queued = buffering;
      buffering = null;
      if (queued !== null) {
        for (const event of queued) {
          publish(machine.applyEvent(event));
        }
      }
    }
  }

  function ensureSeeded(): Promise<void> {
    if (seeded) {
      return Promise.resolve();
    }
    seeding ??= doSeed();
    return seeding;
  }

  function snapshot(): SnapshotMessage {
    return {
      type: ServerMessageType.Snapshot,
      sessionId: options.sessionId,
      cursor,
      projection: machine.projection,
    };
  }

  function settingsMessage(settings: PiSettings): SettingsMessage {
    return { type: ServerMessageType.Settings, sessionId: options.sessionId, ...settings };
  }

  /** Re-read pi's settings and hand them to every viewer, so the status strip shows pi's values. */
  async function broadcastSettings(): Promise<void> {
    const pi = await ensureChild();
    const message = settingsMessage(await pi.settings());
    for (const viewer of [...viewers]) {
      viewer.onMessage(message);
    }
  }

  return {
    sessionId: options.sessionId,
    get activity() {
      return sessionActivityOf(machine.projection.runState);
    },
    async attach(viewer, from) {
      await ensureSeeded();
      const missed = missedFrom(from);
      if (missed === undefined) {
        viewer.onMessage(snapshot());
      } else {
        for (const message of missed) {
          viewer.onMessage(message);
        }
      }
      // Registering after the synchronous sends keeps the replayed Deltas ahead of every new one.
      viewers.add(viewer);
      // Settings are read from pi on every attach rather than replayed, so a browser that was
      // disconnected when a setting changed still sees pi's current value.
      try {
        viewer.onMessage(settingsMessage(await (await ensureChild()).settings()));
      } catch {
        // A supplementary read must not fail a subscription that already delivered a Snapshot.
      }
      return () => {
        viewers.delete(viewer);
      };
    },
    async prompt(text, images, behavior) {
      await ensureSeeded();
      const pi = await ensureChild();
      await pi.prompt(text, images, behavior);
    },
    async abort() {
      await ensureSeeded();
      publish(machine.markAborted());
      const pi = await ensureChild();
      await pi.abort();
    },
    async setModel(provider, modelId) {
      await ensureSeeded();
      await (await ensureChild()).setModel(provider, modelId);
      await broadcastSettings();
    },
    async setThinkingLevel(level) {
      await ensureSeeded();
      await (await ensureChild()).setThinkingLevel(level);
      await broadcastSettings();
    },
    async setAutoCompaction(enabled) {
      await ensureSeeded();
      await (await ensureChild()).setAutoCompaction(enabled);
      await broadcastSettings();
    },
    async close() {
      viewers.clear();
      unsubscribe?.();
      unsubscribe = undefined;
      const pending = starting;
      starting = undefined;
      if (pending !== undefined) {
        await (await pending).stop().catch(() => undefined);
      }
    },
  };
}

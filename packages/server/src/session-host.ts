/**
 * One Session as the server holds it: a lazily started Pi child, the live Projection built from its
 * events, and the viewers that receive the Projection's Deltas. A child is addressed either by the
 * Session file it opens or by a fresh server-generated id, so no two children can write one file.
 *
 * The Session outlives its child. A child is stopped when nobody watches it (eviction) or dies on its
 * own (a crash), and the Session keeps its Projection either way: opening it starts a new child from
 * the same Session file, which is what makes both events recoverable rather than fatal.
 */

import {
  ServerMessageType,
  SessionActivity,
  sessionActivityOf,
  type CommandsMessage,
  type Cursor,
  type DeltaMessage,
  type ImageAttachment,
  type PiChildExit,
  type ProjectionDelta,
  type ServerMessage,
  type SessionStats,
  type SettingsMessage,
  type SnapshotMessage,
  type StreamingBehavior,
  type SubagentAgent,
  type ThinkingLevel,
} from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ServerClock } from "./clock.js";
import { createDeltaHistory } from "./delta-history.js";
import type { PiChildLaunch, PiSessionTarget, PiSettings } from "./pi-child.js";
import { createSessionChild, type SessionChild } from "./session-child.js";
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
  /** Run a `!`/`!!` shell command; `!!` keeps its output out of the model's context. */
  bash(command: string, excludeFromContext: boolean): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  /** pi's statistics for this Session, read on demand for the session panel. */
  sessionStats(): Promise<SessionStats>;
  /** Rename the Session in pi; the caller refreshes the Session list afterwards. */
  setSessionName(name: string): Promise<void>;
  /** Export the Session to HTML inside the served directory; returns pi's relative path. */
  exportHtml(): Promise<string>;
  /**
   * When this Session's child becomes evictable if nothing else happens, or `undefined` when it is
   * not a candidate now: watched, working, already gone, or not started yet.
   */
  evictionDueAt(idleTimeoutMs: number): number | undefined;
  /** Stop the child and keep the Session; the next viewer starts a new one from the same file. */
  evict(): Promise<void>;
  /** Start a new child for a Session whose child is gone, and hand every viewer its Projection. */
  reconnect(): Promise<void>;
  close(): Promise<void>;
}

/** The bridge a Session's Pi child must connect before the Session is served. */
export interface BridgeGate {
  waitForSession(sessionId: string): Promise<void>;
  /** Subscribe to the agent records the child's bridge sends; returns an unsubscribe. */
  onAgent(listener: (sessionId: string, agent: SubagentAgent) => void): () => void;
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
  /** Called when anything that decides eviction changed: a viewer, a run, or a publish. */
  readonly onIdleChange?: (() => void) | undefined;
}

export function createSessionHost(options: SessionHostOptions): SessionHost {
  const machine = createSessionProjectionMachine(options.sessionId, options.launch.cwd);
  const viewers = new Set<SessionViewer>();
  const history = createDeltaHistory();
  let cursor = 0;
  let seeded = false;
  let seeding: Promise<void> | undefined;
  let restarting: Promise<void> | undefined;
  /**
   * Last working state reported upward, so a text-only Delta never triggers a list refresh. It
   * starts idle because seeding only fills entries, so a freshly attached Session has no change to
   * report and must not cost every viewer a list refresh.
   */
  let reportedActivity: SessionActivity = SessionActivity.Idle;
  /** Events delivered while the seed reads pi; applied once the Projection exists, never dropped. */
  let buffering: JsonAgentSessionEvent[] | null = null;
  /** The last moment this Session did anything, which is where its idle window starts. */
  let lastActivityAt = options.clock.now();

  const child: SessionChild = createSessionChild({
    target: options.target,
    launch: options.launch,
    onEvent: (event) => {
      onEvent(event);
    },
    onLost: (exit) => {
      onLost(exit);
    },
  });

  /** Record that the Session is in use, so an idle window starts from now rather than from before. */
  function touch(): void {
    lastActivityAt = options.clock.now();
    options.onIdleChange?.();
  }

  /** Report the current working state when it changed, and only then. */
  function reportActivity(): void {
    const activity = sessionActivityOf(machine.projection.runState);
    if (activity === reportedActivity) {
      return;
    }
    reportedActivity = activity;
    options.onActivity?.(options.sessionId, activity);
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
    history.retain(message, options.clock.now());
    reportActivity();
    touch();
    for (const viewer of [...viewers]) {
      viewer.onMessage(message);
    }
  }

  function onEvent(event: JsonAgentSessionEvent): void {
    if (buffering !== null) {
      buffering.push(event);
      return;
    }
    publish(machine.applyEvent(event));
  }

  /**
   * A child that died on its own leaves the Session with nothing running and no way to continue, so
   * the transcript says exactly that: the exit pi's process reported, and the Reconnect the reader
   * needs to start another one from the file.
   */
  function onLost(exit: PiChildExit): void {
    publish(machine.markCrashed(exit));
  }

  /**
   * Agent records arrive on the bridge, not pi's RPC. They are applied to the Projection even before
   * the transcript is seeded, so a bridge record that beats pi's first read still reaches the
   * Snapshot; publishing waits for seeding so no viewer receives a Delta against a Projection it
   * has not been sent.
   */
  const unsubscribeAgents = options.bridge.onAgent((sessionId, agent) => {
    if (sessionId !== options.sessionId) {
      return;
    }
    publish(machine.applySubagent(agent));
  });

  async function doSeed(): Promise<void> {
    buffering = [];
    // Registered before the child starts: the extension connects on its own session start, which can
    // beat the first read from pi, and a handshake that arrives early must not be refused.
    const bridgeReady = options.bridge.waitForSession(options.sessionId);
    void bridgeReady.catch(() => undefined);
    try {
      const pi = await child.ensure();
      await bridgeReady;
      const { entries, leafId } = await pi.entries();
      cursor = machine.seed(entries, leafId);
      // A reseed renumbers Cursors, so nothing retained describes the new stream.
      history.clear();
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
    return seedNow();
  }

  /** One seed at a time: a seed reads pi and replaces the whole Projection. */
  function seedNow(): Promise<void> {
    seeding ??= doSeed().finally(() => {
      seeding = undefined;
    });
    return seeding;
  }

  /**
   * Replace the child and rebuild the Projection from the Session file. Two viewers arriving at an
   * evicted Session share one restart, so a Session can never run two children at once.
   */
  function restart(): Promise<void> {
    restarting ??= doRestart().finally(() => {
      restarting = undefined;
    });
    return restarting;
  }

  async function doRestart(): Promise<void> {
    await child.stop();
    // The child wrote to the Session file while it ran, so the Projection is rebuilt from the file
    // rather than trusted: a crash may have persisted an entry no Delta ever carried.
    seeded = false;
    await seedNow();
    for (const viewer of [...viewers]) {
      viewer.onMessage(snapshot());
    }
  }

  /**
   * Make the Session servable: seed it the first time, and replace a child that is gone. Without this
   * a viewer's timing would decide whether the Session has a child, and an evicted or crashed Session
   * would answer its next request from a Projection nothing is behind.
   */
  async function ensureServed(): Promise<void> {
    if (!seeded) {
      await ensureSeeded();
      return;
    }
    if (!child.running) {
      await restart();
    }
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

  function commandsMessage(commands: CommandsMessage["commands"]): CommandsMessage {
    return { type: ServerMessageType.Commands, sessionId: options.sessionId, commands };
  }

  /** Re-read pi's settings and hand them to every viewer, so the status strip shows pi's values. */
  async function broadcastSettings(): Promise<void> {
    const message = settingsMessage(await (await child.ensure()).settings());
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
      await ensureServed();
      const missed = history.missedFrom(from, cursor);
      if (missed === undefined) {
        viewer.onMessage(snapshot());
      } else {
        for (const message of missed) {
          viewer.onMessage(message);
        }
      }
      // Registering after the synchronous sends keeps the replayed Deltas ahead of every new one.
      viewers.add(viewer);
      touch();
      // Settings are read from pi on every attach rather than replayed, so a browser that was
      // disconnected when a setting changed still sees pi's current value.
      try {
        viewer.onMessage(settingsMessage(await (await child.ensure()).settings()));
      } catch {
        // A supplementary read must not fail a subscription that already delivered a Snapshot.
      }
      // The palette's discoverable commands come from the same child, so they are read on attach
      // and never cached across a Session switch that could point them at the wrong child.
      try {
        viewer.onMessage(commandsMessage(await (await child.ensure()).commands()));
      } catch {
        // A child that cannot list commands still serves its transcript; the palette falls back to
        // the built-ins rather than failing the subscription.
      }
      return () => {
        viewers.delete(viewer);
        touch();
      };
    },
    async prompt(text, images, behavior) {
      await ensureServed();
      await (await child.ensure()).prompt(text, images, behavior);
    },
    async bash(command, excludeFromContext) {
      await ensureServed();
      publish(machine.bash.begin(command, excludeFromContext));
      try {
        const outcome = await (await child.ensure()).bash(command, excludeFromContext);
        publish(machine.bash.end(outcome.output, outcome));
      } catch (error) {
        // A command that never reached pi must not leave a card that looks like it ran.
        publish(machine.bash.discard());
        throw error;
      }
    },
    async abort() {
      await ensureServed();
      publish(machine.markAborted());
      await (await child.ensure()).abort();
    },
    async setModel(provider, modelId) {
      await ensureServed();
      await (await child.ensure()).setModel(provider, modelId);
      await broadcastSettings();
      touch();
    },
    async setThinkingLevel(level) {
      await ensureServed();
      await (await child.ensure()).setThinkingLevel(level);
      await broadcastSettings();
      touch();
    },
    async setAutoCompaction(enabled) {
      await ensureServed();
      await (await child.ensure()).setAutoCompaction(enabled);
      await broadcastSettings();
      touch();
    },
    async sessionStats() {
      await ensureServed();
      touch();
      return await (await child.ensure()).stats();
    },
    async setSessionName(name) {
      await ensureServed();
      touch();
      await (await child.ensure()).setSessionName(name);
    },
    async exportHtml() {
      await ensureServed();
      touch();
      return await (await child.ensure()).exportHtml();
    },
    evictionDueAt(idleTimeoutMs) {
      // A watched Session is never evicted, and neither is one with work in flight: the child is
      // needed to finish it, and stopping it would lose output the reader is waiting for.
      if (!seeded || !child.running || viewers.size > 0) {
        return undefined;
      }
      return sessionActivityOf(machine.projection.runState) === SessionActivity.Idle
        ? lastActivityAt + idleTimeoutMs
        : undefined;
    },
    async evict() {
      // The Session is its file; stopping the child costs the Projection nothing that a reseed cannot
      // rebuild, and it is what bounds the pool's memory.
      await child.stop();
      options.onIdleChange?.();
    },
    async reconnect() {
      // Unconditional: the reader asked for a new child, so even one that is still running is
      // replaced. The Projection is rebuilt from the Session file either way.
      await restart();
    },
    async close() {
      unsubscribeAgents();
      viewers.clear();
      await child.stop();
    },
  };
}

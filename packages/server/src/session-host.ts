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
  type Cursor,
  type DeltaMessage,
  type ForkMessage,
  type ImageAttachment,
  type PiChildExit,
  type ProjectionDelta,
  type ServerMessage,
  type SessionRef,
  type SessionStats,
  type SessionTree,
  type SnapshotMessage,
  type StreamingBehavior,
  type SubagentTranscriptLookup,
  type ThinkingLevel,
} from "@pi-my-ui/protocol";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ServerClock } from "./clock.js";
import type { BridgeGate } from "./bridge/gate.js";
import { attachBridgeEvents } from "./bridge/events.js";
import { createDeltaHistory } from "./delta-history.js";
import { createPastTranscriptReader } from "./past-transcripts.js";
import { contextUsageMessage, sendAttachSupplements, settingsMessage } from "./session-attach.js";
import type { PiChildLaunch, PiSessionTarget } from "./pi-child.js";
import { createSessionChild, type SessionChild } from "./session-child.js";
import { createSessionLeaf } from "./session-leaf.js";
import { createSessionMutations, type SessionMutationOutcome } from "./session-mutation.js";
import { createSessionProjectionMachine } from "./session-projection.js";
import { refuseReload } from "./session-reload.js";
import { createSessionSteering } from "./session-steering.js";

/** A recipient of one Session's Snapshot and Deltas; the connection implements it over its socket. */
export interface SessionViewer {
  onMessage(message: ServerMessage): void;
}

export interface SessionHost {
  /** The Project and id that name this Session on the wire and in the pool. */
  readonly session: SessionRef;
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
  steerSubagent(agentId: string, message: string): Promise<void>;
  /**
   * One settled run's own conversation, read from the session file pi-subagents wrote for it, or the
   * reason it cannot be read. Only a run this process did not stream needs a file.
   */
  subagentTranscript(agentId: string): Promise<SubagentTranscriptLookup>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  /** Compact the Session now; `customInstructions` is the focus typed after `/compact`. */
  compact(customInstructions?: string): Promise<void>;
  /** pi's statistics for this Session, read on demand for the session panel. */
  sessionStats(): Promise<SessionStats>;
  /** Rename the Session in pi; the caller refreshes the Session list afterwards. */
  setSessionName(name: string): Promise<void>;
  /** Export the Session to HTML inside the served directory; returns pi's relative path. */
  exportHtml(): Promise<string>;
  /** The user messages a fork can start from, so the picker offers pi's own choices. */
  forkMessages(): Promise<readonly ForkMessage[]>;
  /** Create a new Session branching from an earlier message, leaving this one as it stands. */
  forkSession(entryId: string): Promise<SessionMutationOutcome>;
  /** Copy this Session's active branch into a new Session, leaving this one as it stands. */
  cloneSession(): Promise<SessionMutationOutcome>;
  /** The Session's whole message tree, for the `tree` view. */
  tree(): Promise<SessionTree>;
  /**
   * Move the Leaf to an entry that already exists, and report the Leaf pi left the Session on. A
   * refusal throws: pi swallows an error inside its own command handler, so the only evidence of a
   * move is the Leaf pi reports afterwards.
   */
  moveLeaf(entryId: string): Promise<{ readonly entryId: string; readonly leafId: string | null }>;
  /**
   * When this Session's child becomes evictable if nothing else happens, or `undefined` when it is
   * not a candidate now: watched, working, already gone, or not started yet.
   */
  evictionDueAt(idleTimeoutMs: number): number | undefined;
  /** Stop the child and keep the Session; the next viewer starts a new one from the same file. */
  evict(): Promise<void>;
  /** Start a new child for a Session whose child is gone, and hand every viewer its Projection. */
  reconnect(): Promise<void>;
  /**
   * Replace the child with a fresh process on the same Session file, reseed the Projection and
   * re-send the attach surfaces to every viewer. A Session with work in flight is refused.
   */
  reload(): Promise<void>;
  close(): Promise<void>;
}

export type { BridgeGate } from "./bridge/gate.js";

export interface SessionHostOptions {
  readonly session: SessionRef;
  /** Which Session the Pi child opens: a file the pool resolved, or a fresh server-generated id. */
  readonly target: PiSessionTarget;
  readonly launch: PiChildLaunch;
  readonly bridge: BridgeGate;
  readonly clock: ServerClock;
  /** Called once per working-state change, so a server can refresh every viewer's Session list. */
  readonly onActivity?: ((session: SessionRef, activity: SessionActivity) => void) | undefined;
  /** Called when anything that decides eviction changed: a viewer, a run, or a publish. */
  readonly onIdleChange?: (() => void) | undefined;
}

export function createSessionHost(options: SessionHostOptions): SessionHost {
  const session = options.session;
  const sessionId = session.id;
  const machine = createSessionProjectionMachine(sessionId, options.clock);
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
  /**
   * Set while pi has rebound the child to another Session, when its events describe that Session and
   * this one's Projection must not take them.
   */
  let holding = false;
  /** The in-flight context-usage read, and whether another was asked for while it ran. */
  let contextRead: Promise<void> | undefined;
  let contextReadQueued = false;

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
    options.onActivity?.(session, activity);
  }

  function publish(deltas: readonly ProjectionDelta[]): void {
    if (deltas.length === 0 || !seeded) {
      return;
    }
    const from = cursor;
    cursor += deltas.length;
    const message: DeltaMessage = {
      type: ServerMessageType.Delta,
      session,
      fromCursor: from,
      cursor,
      deltas,
    };
    history.retain(message, options.clock.now());
    reportActivity();
    touch();
    broadcast(message);
  }

  function onEvent(event: JsonAgentSessionEvent): void {
    if (holding) {
      return;
    }
    if (buffering !== null) {
      buffering.push(event);
      return;
    }
    publish(machine.applyEvent(event));
    // pi pushes no context-usage event, so the two moments the figure can change are pulled: a
    // settled run (a fresh reply gives pi a measurement) and the end of a compaction (pi reports an
    // empty figure until such a reply). No other event changes it, so none spends a read.
    if (event.type === "agent_settled" || event.type === "compaction_end") {
      refreshContextUsage();
    }
  }

  function broadcast(message: ServerMessage): void {
    for (const viewer of [...viewers]) {
      viewer.onMessage(message);
    }
  }

  /** One read at a time, and a read asked for during one runs after it, so figures cannot arrive
   * out of order. A failed read sends nothing: a stale figure is better than a fabricated empty one. */
  function refreshContextUsage(): void {
    if (contextRead !== undefined) {
      contextReadQueued = true;
      return;
    }
    contextRead = (async () => {
      try {
        const stats = await (await child.ensure()).stats();
        broadcast(contextUsageMessage(session, stats.contextUsage));
      } catch {
        // The transcript is served whether or not pi can report its context size.
      }
    })().finally(() => {
      contextRead = undefined;
      if (contextReadQueued) {
        contextReadQueued = false;
        refreshContextUsage();
      }
    });
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
   * Agent records and their conversations arrive on the bridge, not pi's RPC. They are applied even
   * before the transcript is seeded, so a record that beats pi's first read still reaches the
   * Snapshot; publishing waits for seeding so no viewer receives a Delta against a Projection it has
   * not been sent.
   */
  const detachBridge = attachBridgeEvents(options.bridge, sessionId, {
    applyAgent: (agent) => publish(machine.applySubagent(agent)),
    applyTranscript: (agentId, event) => publish(machine.applySubagentEvent(agentId, event)),
  });

  async function doSeed(): Promise<void> {
    buffering = [];
    // Registered before the child starts: the extension connects on its own session start, which can
    // beat the first read from pi, and a handshake that arrives early must not be refused.
    const bridgeReady = options.bridge.waitForSession(sessionId);
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

  /**
   * Rebuild the Projection from the Session file and hand every viewer a fresh Snapshot. A reseed
   * renumbers Cursors, so nothing retained describes the new stream.
   */
  async function reseedProjection(): Promise<void> {
    seeded = false;
    await seedNow();
    broadcast(snapshot());
  }

  async function doRestart(): Promise<void> {
    await child.stop();
    // The child wrote to the Session file while it ran, so the Projection is rebuilt from the file
    // rather than trusted: a crash may have persisted an entry no Delta ever carried.
    await reseedProjection();
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
      session,
      cursor,
      projection: machine.projection,
    };
  }

  /** Re-read pi's settings and hand them to every viewer, so the status strip shows pi's values. */
  async function broadcastSettings(): Promise<void> {
    const message = settingsMessage(session, await (await child.ensure()).settings());
    broadcast(message);
  }

  /**
   * The tree and its Leaf moves read and write pi through the same child the rest of the host uses;
   * the module owns the confirmation rule, so this host only says where the pieces are.
   */
  const leaf = createSessionLeaf({
    serve: ensureServed,
    child: () => child.ensure(),
    leafId: () => machine.projection.leafId,
    rebuild: reseedProjection,
    touch,
  });

  const steering = createSessionSteering(
    { sessionId, bridge: options.bridge },
    ensureServed,
    touch,
  );

  /**
   * A settled run's conversation lives in its own session file, beside the Session's; the reader
   * owns that join. The Session's current file is asked for each time because a fork or a clone
   * rebinds the child to a new one.
   */
  const readSubagentTranscript = createPastTranscriptReader({
    serve: ensureServed,
    sessionFile: async () => (await (await child.ensure()).stats()).sessionFile,
    agents: () => machine.projection.subagents,
  });

  /**
   * Fork and clone share one procedure (pi rebinds the child, so this Session has to be rebuilt from
   * its own file), and that procedure lives in its own module rather than growing this one.
   */
  const mutations = createSessionMutations({
    sessionId,
    prepare: ensureServed,
    child: () => child.ensure(),
    stopChild: () => child.stop(),
    rebuild: restart,
    holdEvents: (held) => {
      holding = held;
    },
    touch,
  });

  return {
    session,
    get sessionId() {
      return session.id;
    },
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
      await sendAttachSupplements(viewer, session, () => child.ensure());
      return () => {
        viewers.delete(viewer);
        touch();
      };
    },
    async prompt(text, images, behavior) {
      await ensureServed();
      await (await child.ensure()).prompt(text, images, behavior);
    },
    steerSubagent: steering.steerSubagent,
    subagentTranscript: readSubagentTranscript,
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
    async compact(customInstructions) {
      await ensureServed();
      // pi reports the compaction on its own event stream, so the in-progress state, the boundary
      // and the cleared context figure all arrive from pi rather than from this call.
      await (await child.ensure()).compact(customInstructions);
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
    async forkMessages() {
      return await mutations.forkMessages();
    },
    forkSession: mutations.fork,
    cloneSession: mutations.clone,
    tree: leaf.tree,
    moveLeaf: leaf.move,
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
    async reload() {
      // The guard reads the Projection before any child work, so a refusal costs the Session nothing.
      const refusal = refuseReload(machine.projection);
      if (refusal !== undefined) {
        throw refusal;
      }
      await restart();
      // Every viewer holds surfaces the old child answered, and they follow the Snapshot so a reader
      // who acts on them is already looking at the reseeded Session. The host's own broadcast is the
      // sink, so the one fan-out in the server stays the one every other message uses.
      await sendAttachSupplements({ onMessage: broadcast }, session, () => child.ensure());
      touch();
    },
    async close() {
      detachBridge();
      viewers.clear();
      await child.stop();
    },
  };
}

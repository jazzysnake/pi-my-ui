/**
 * A settled run's own conversation, read from the session file pi-subagents wrote for it.
 *
 * A running agent's conversation reaches the server over the bridge, and nothing on that path touches
 * a file, so a fresh process holds no conversation for any run of an earlier one. pi-subagents does
 * persist every top-level run as its own pi session, so that file is the honest source and the only
 * one.
 *
 * The join from an agent record to its file is the run id: pi-subagents names the child session
 * `<agent type>#<first characters of the run id>` and points the child's header at the Session file
 * that spawned it. A prefix that short can collide, and a plausible but wrong conversation is worse
 * than none, so the join refuses rather than guesses: the prefix must name exactly one of the
 * Session's own runs, and exactly one child under the Session may carry it. It can therefore only
 * fail to find a conversation, never open another run's.
 *
 * The scan reads every sibling of the Session through pi's own reader, which costs what the Session
 * drawer's listing already costs on each refresh. The answer is cached per run, so a focus pays it
 * once.
 */

import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  ProjectionDeltaKind,
  SubagentRunKind,
  SubagentTranscriptLookupKind,
  type ProjectedEntry,
  type SubagentAgent,
  type SubagentTranscriptLookup,
} from "@pi-my-ui/protocol";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { projectionBatch } from "./projection.js";

/** Characters of the run id that pi-subagents puts in a child session's name. */
const AGENT_ID_PREFIX_LENGTH = 8;

/** Only these files are session files, the same rule pi's own discovery uses. */
const SESSION_FILE_EXTENSION = ".jsonl";

export interface PastTranscriptRequest {
  /** The spawning Session's file; a child's header names it as its parent. */
  readonly sessionFile: string;
  /** The run whose conversation is wanted, by the id the Projection lists it under. */
  readonly agentId: string;
  /** Every run id this Session lists, so a shared prefix is refused before any file is read. */
  readonly agentIds: readonly string[];
}

/** The first characters of a run id, in the lower case a child's name is written in. */
function prefixOf(id: string): string | undefined {
  return id.length < AGENT_ID_PREFIX_LENGTH
    ? undefined
    : id.slice(0, AGENT_ID_PREFIX_LENGTH).toLowerCase();
}

/** The run id prefix a child session's own name ends with, or `undefined` for any other shape. */
function childPrefixOf(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const marker = name.lastIndexOf("#");
  const tail = name.slice(marker + 1);
  return marker !== -1 && tail.length === AGENT_ID_PREFIX_LENGTH ? tail.toLowerCase() : undefined;
}

function unreadable(detail: string): SubagentTranscriptLookup {
  return {
    kind: SubagentTranscriptLookupKind.Unavailable,
    reason: `the run's own session file could not be read (${detail})`,
  };
}

function ambiguous(): SubagentTranscriptLookup {
  return {
    kind: SubagentTranscriptLookupKind.Unavailable,
    reason:
      "more than one run or child session matches this agent's id, so opening one conversation " +
      "could show another run's",
  };
}

/** One candidate child session, opened as far as its header and name. */
interface Sibling {
  readonly path: string;
  readonly manager: SessionManager;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The child session files under `sessionFile` that name it as their parent, each opened once. A
 * sibling that cannot be read is returned as its failure: it might be the wanted child, so the
 * lookup refuses instead of concluding the conversation is gone.
 */
function childSiblings(
  sessionFile: string,
): { readonly siblings: readonly Sibling[] } | { readonly refused: SubagentTranscriptLookup } {
  const directory = dirname(sessionFile);
  const parentPath = resolve(sessionFile);
  let names: string[];
  try {
    names = readdirSync(directory).filter(
      (name) => name.endsWith(SESSION_FILE_EXTENSION) && name !== basename(sessionFile),
    );
  } catch (error) {
    return { refused: unreadable(`${directory}: ${errorText(error)}`) };
  }
  const siblings: Sibling[] = [];
  for (const name of names) {
    const path = join(directory, name);
    let manager: SessionManager;
    try {
      manager = SessionManager.open(path);
      const header = manager.getHeader();
      if (header === null || resolve(header.parentSession ?? "") !== parentPath) {
        continue;
      }
      // Reading the name loads the file, which is where an unreadable or truncated sibling fails.
      manager.getSessionName();
    } catch (error) {
      return { refused: unreadable(`${name}: ${errorText(error)}`) };
    }
    siblings.push({ path, manager });
  }
  return { siblings };
}

/** The transcript rows of one child session, projected by the Session transcript's own projector. */
function transcriptEntries(manager: SessionManager): readonly ProjectedEntry[] {
  const entries = manager.getEntries();
  const leafId = manager.getLeafId() ?? entries[entries.length - 1]?.id ?? null;
  const batch = projectionBatch({ entries, leafId, fromCursor: 0 });
  const projected: ProjectedEntry[] = [];
  for (const delta of batch.deltas) {
    if (delta.kind === ProjectionDeltaKind.EntryUpsert) {
      projected.push(delta.entry);
    }
  }
  return projected;
}

/**
 * Read `request.agentId`'s conversation, or say why it cannot be read. Never throws: every failure
 * is a stated outcome, because the client draws all three of them differently.
 */
export function readPastTranscript(request: PastTranscriptRequest): SubagentTranscriptLookup {
  const prefix = prefixOf(request.agentId);
  if (prefix === undefined) {
    return {
      kind: SubagentTranscriptLookupKind.Unavailable,
      reason: `the agent id ${request.agentId} is too short to name a child session file`,
    };
  }
  const matches = request.agentIds.filter((id) => prefixOf(id) === prefix);
  if (matches.length !== 1 || matches[0] !== request.agentId) {
    return ambiguous();
  }

  const found = childSiblings(request.sessionFile);
  if ("refused" in found) {
    return found.refused;
  }
  const siblings = found.siblings;
  const children = siblings.filter(
    (sibling) => childPrefixOf(sibling.manager.getSessionName()) === prefix,
  );
  const only = children.length === 1 ? children[0] : undefined;
  if (only === undefined) {
    return children.length === 0 ? { kind: SubagentTranscriptLookupKind.Absent } : ambiguous();
  }
  try {
    return { kind: SubagentTranscriptLookupKind.Found, entries: transcriptEntries(only.manager) };
  } catch (error) {
    return unreadable(`${basename(only.path)}: ${errorText(error)}`);
  }
}

/** What a reader needs from the Session it reads for. */
export interface PastTranscriptReaderOptions {
  /** Make the Session servable, so its file is the one pi is bound to now. */
  readonly serve: () => Promise<void>;
  /** The Session file pi has bound this Session to, or `null` while it has none. */
  readonly sessionFile: () => Promise<string | null>;
  /** The agents this Session reports, live and settled, so a shared run-id prefix is refused. */
  readonly agents: () => readonly SubagentAgent[];
}

/**
 * One Session's reader, cached per agent. A settled run's file cannot change after it settles, so
 * one read serves every later focus of that run; the Session's own file is asked for each time,
 * because a fork or a clone moves it.
 */
export function createPastTranscriptReader(
  options: PastTranscriptReaderOptions,
): (agentId: string) => Promise<SubagentTranscriptLookup> {
  const seen = new Map<string, SubagentTranscriptLookup>();
  return async (agentId) => {
    const cached = seen.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    await options.serve();
    const sessionFile = await options.sessionFile();
    if (sessionFile === null) {
      return { kind: SubagentTranscriptLookupKind.Absent };
    }
    const agentIds = options
      .agents()
      .filter((agent) => agent.runKind === SubagentRunKind.Agent)
      .map((agent) => agent.id);
    const lookup = readPastTranscript({ sessionFile, agentId, agentIds });
    seen.set(agentId, lookup);
    return lookup;
  };
}

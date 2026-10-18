/**
 * The Projection a Session starts from: its entries projected, plus the agents that ran for it.
 *
 * Seeding is not only the transcript, because a reseed has to decide what survives from the live
 * Projection. Agent records do: the bridge can report an agent before pi's entries finish reading,
 * and an agent working right now is not in the entries yet. Workflow runs and settled agents are the
 * opposite: nothing live reports a workflow run, and a fresh process can hear nothing about the runs
 * of an earlier one, so both are re-derived from the same entries rather than carried over.
 */

import {
  RunStateKind,
  SubagentRunKind,
  reduceDeltaBatch,
  type DeltaBatch,
  type SessionProjection,
  type SubagentAgent,
} from "@pi-my-ui/protocol";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { subagentRunsFromEntries } from "./subagent-runs.js";
import { workflowRunsFromEntries } from "./workflow-runs.js";

export interface SessionSeed {
  readonly sessionId: string;
  readonly entries: readonly SessionEntry[];
  /** The agents already projected; a run in progress outlives the reseed that describes it. */
  readonly live: readonly SubagentAgent[];
  /** The entries projected through the shared reducer, which also produces the Cursor. */
  readonly batch: DeltaBatch;
}

export function seededProjection(seed: SessionSeed): SessionProjection {
  const live = seed.live.filter((agent) => agent.runKind !== SubagentRunKind.Workflow);
  const liveIds = new Set(live.map((agent) => agent.id));
  const settled = subagentRunsFromEntries(seed.entries).filter((agent) => !liveIds.has(agent.id));
  return reduceDeltaBatch(
    {
      sessionId: seed.sessionId,
      leafId: null,
      entries: [],
      runState: { kind: RunStateKind.Idle },
      subagents: [...live, ...settled, ...workflowRunsFromEntries(seed.entries)],
      subagentTranscripts: [],
    },
    seed.batch,
  );
}

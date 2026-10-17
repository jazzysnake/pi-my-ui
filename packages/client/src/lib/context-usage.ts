/**
 * The session bar's context readout. One pure mapping from pi's {@link ContextUsage} to the state and
 * text the bar shows, so the thresholds and the wording are defined once and tested without a DOM.
 *
 * pi does not push a usage event: the server reads it on attach and re-reads it when it can change.
 * A figure pi is recomputing is therefore a real state the readout has to name, not an absence.
 */

import type { ContextUsage } from "@pi-my-ui/protocol";

/** Percent of the window at which the readout warns: pi's own auto-compaction is closer than this. */
export const CONTEXT_WARNING_PERCENT = 75;

/** Percent of the window at which the readout is critical: the next turns will hit pi's threshold. */
export const CONTEXT_CRITICAL_PERCENT = 90;

export const ContextMeterState = {
  Normal: "normal",
  Warning: "warning",
  Critical: "critical",
  /** pi is recomputing: right after compaction it has no figure until a later reply. */
  Recalculating: "recalculating",
  /** pi has no figure at all, because no model or context window is available. */
  Unavailable: "unavailable",
} as const;

export type ContextMeterState = (typeof ContextMeterState)[keyof typeof ContextMeterState];

export const CONTEXT_RECALCULATING_TEXT = "Recalculating…";
export const CONTEXT_UNAVAILABLE_TEXT = "unavailable";

export interface ContextMeter {
  readonly state: ContextMeterState;
  readonly text: string;
}

/** A token count a phone can read at a glance, without losing the order of magnitude. */
function compactTokens(tokens: number): string {
  if (tokens < 1_000) {
    return String(tokens);
  }
  if (tokens < 100_000) {
    const thousands = tokens / 1_000;
    return `${Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1)}k`;
  }
  return `${Math.round(tokens / 1_000)}k`;
}

function stateFor(percent: number | null): ContextMeterState {
  if (percent === null) {
    return ContextMeterState.Recalculating;
  }
  if (percent >= CONTEXT_CRITICAL_PERCENT) {
    return ContextMeterState.Critical;
  }
  if (percent >= CONTEXT_WARNING_PERCENT) {
    return ContextMeterState.Warning;
  }
  return ContextMeterState.Normal;
}

/** What the readout shows for one of pi's figures. */
export function contextMeter(usage: ContextUsage | null): ContextMeter {
  if (usage === null) {
    return { state: ContextMeterState.Unavailable, text: CONTEXT_UNAVAILABLE_TEXT };
  }
  const state = stateFor(usage.percent);
  if (state === ContextMeterState.Recalculating || usage.tokens === null) {
    return { state: ContextMeterState.Recalculating, text: CONTEXT_RECALCULATING_TEXT };
  }
  const percent = usage.percent === null ? "" : ` · ${String(Math.round(usage.percent))}%`;
  return {
    state,
    text: `${compactTokens(usage.tokens)} / ${compactTokens(usage.contextWindow)}${percent}`,
  };
}

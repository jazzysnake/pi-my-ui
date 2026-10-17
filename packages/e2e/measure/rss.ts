/**
 * Resident memory of a process, read from the operating system rather than asked of the runtime, so a
 * footprint measurement covers the whole process a Pi child is instead of one heap inside it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PROC_STATUS = "/proc/self/status";

/** Whether this machine exposes per-process resident memory through `/proc`. */
export const HAS_PROC_STATUS = existsSync(PROC_STATUS);

/** `pid`'s resident set in kilobytes, or `undefined` once the process is gone. */
export function residentKb(pid: number): number | undefined {
  if (HAS_PROC_STATUS) {
    try {
      const match = /^VmRSS:\s+(\d+) kB$/m.exec(
        readFileSync(`/proc/${String(pid)}/status`, "utf8"),
      );
      return match === null ? undefined : Number.parseInt(match[1] ?? "", 10);
    } catch {
      return undefined;
    }
  }
  try {
    const printed = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
    const parsed = Number.parseInt(printed.trim(), 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** One reading, per process and in total. */
export interface RssSample {
  readonly totalKb: number;
  readonly perPidKb: Readonly<Record<number, number>>;
}

export interface RssPeak extends RssSample {
  readonly samples: number;
}

const DEFAULT_INTERVAL_MS = 25;

/**
 * Poll `pids` for as long as `phase` runs and report the highest total seen, which is the number a
 * pool's footprint has to be budgeted from: a child's steady state says nothing about its peak.
 */
export async function peakWhile(
  phase: () => Promise<void>,
  pids: () => readonly number[],
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Promise<RssPeak> {
  let peak: RssPeak = { totalKb: 0, perPidKb: {}, samples: 0 };

  function take(): void {
    const perPidKb: Record<number, number> = {};
    let totalKb = 0;
    for (const pid of pids()) {
      const kb = residentKb(pid);
      if (kb === undefined) {
        continue;
      }
      perPidKb[pid] = kb;
      totalKb += kb;
    }
    peak = { totalKb, perPidKb, samples: peak.samples + 1 };
  }

  take();
  const timer = setInterval(take, intervalMs);
  try {
    await phase();
  } finally {
    clearInterval(timer);
    take();
  }
  return peak;
}

/** Megabytes with one decimal, the unit a footprint budget is stated in. */
export function mb(kb: number): string {
  return `${(kb / 1024).toFixed(1)} MB`;
}

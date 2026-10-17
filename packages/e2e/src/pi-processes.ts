import { execFileSync } from "node:child_process";

/**
 * The `pi` children of this test worker, by pid. The server's Pi children are spawned by the worker
 * that runs the server and pi titles its process `pi`, so a child of this process named `pi` is one:
 * counting them is how a spec sees the pool's real footprint.
 */
export function piChildPids(): number[] {
  const output = execFileSync("ps", ["-eww", "-o", "pid=,ppid=,args="], { encoding: "utf8" });
  const pids: number[] = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[0] ?? "", 10);
    const ppid = Number.parseInt(parts[1] ?? "", 10);
    const command = parts.slice(2).join(" ");
    if (ppid === process.pid && command === "pi" && Number.isInteger(pid)) {
      pids.push(pid);
    }
  }
  return pids;
}

/** Whether `pid` is currently one of this worker's Pi children. */
export function isPiChildAlive(pid: number): boolean {
  return piChildPids().includes(pid);
}

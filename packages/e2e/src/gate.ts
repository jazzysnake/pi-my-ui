/**
 * A gate is a file whose absence holds a scripted Bash command until the test says the state it
 * wants to assert is on screen.
 *
 * The contract is observe-then-release: a test opens a gate only after it has observed the state the
 * gate protects. Releasing first turns the gate into a race that always passes, so the only
 * test-facing release is {@link Gate.releaseAfter}, which takes the observations. The plain release
 * is not on the test-facing surface at all: it belongs to the harness teardown, which must free a run
 * even when an assertion failed first.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { HermeticHome } from "./pi-harness";

/**
 * How long a blocked command waits for its gate. This bounds a leaked gate at thirty seconds
 * instead of the test timeout, and it is short enough that a gate nobody intends to open still
 * fails the test that wrote it rather than the suite.
 */
const WAIT_SECONDS = 30;

/**
 * The scripted Bash tool's own budget. It must exceed {@link WAIT_SECONDS}, or the tool would kill
 * the command before the poll could report which gate was never opened.
 */
const TOOL_TIMEOUT_SECONDS = 60;

const GATE_NAME = /^[a-z0-9][a-z0-9-]*$/;

const POLL_INTERVAL_SECONDS = "0.1";

/** The gate directory beside the hermetic workspace, never inside a served Project. */
const GATES_DIRECTORY = "gates";

/** What a scripted Bash command needs to block on a gate, in the shape pi's bash tool takes. */
export interface GatedBashCommand {
  readonly command: string;
  /** Seconds; always above the poll's own bound. */
  readonly timeout: number;
}

export interface Gate {
  /** The Bash tool arguments that wait for this gate and then run `after`. */
  command(after: string): GatedBashCommand;
  /**
   * Run `observe` to completion, then open the gate. `observe` is where the test asserts the state
   * the gate protects; if it throws, the gate stays shut and teardown releases it.
   */
  releaseAfter<T>(observe: () => Promise<T>): Promise<T>;
}

/** The only gate surface a test has: it names a gate, it cannot open one without observing. */
export interface Gates {
  /** The directory the gate files live in; outside every Project the harness serves. */
  readonly root: string;
  /** The same name always yields the same gate, so two call sites cannot write two files. */
  gate(name: string): Gate;
}

/** Harness teardown's surface: it opens every gate a test holds, observed or not. */
export interface OwnedGates extends Gates {
  releaseAll(): Promise<void>;
}

interface OwnedGate extends Gate {
  release(): Promise<void>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function createGate(root: string, name: string, index: number): OwnedGate {
  // Absolute, derived from the per-test hermetic root, so a command in any cwd finds the same file.
  const path = resolve(root, `${String(index)}-${name}`);
  const quoted = shellQuote(path);
  let opening: Promise<void> | undefined;

  const release = (): Promise<void> => {
    opening ??= (async () => {
      await mkdir(root, { recursive: true });
      await writeFile(path, "released\n", { encoding: "utf8", flag: "a" });
    })();
    return opening;
  };

  return {
    command(after) {
      const gaveUp = `gate ${name} was never opened; waited ${String(WAIT_SECONDS)}s`;
      return {
        command: [
          `deadline=$((SECONDS+${String(WAIT_SECONDS)}))`,
          `until [ -e ${quoted} ]; do`,
          `  [ "$SECONDS" -lt "$deadline" ] || { echo ${shellQuote(gaveUp)} >&2; exit 1; }`,
          `  sleep ${POLL_INTERVAL_SECONDS}`,
          "done",
          after,
        ].join("\n"),
        timeout: TOOL_TIMEOUT_SECONDS,
      };
    },
    async releaseAfter(observe) {
      const observed = await observe();
      await release();
      return observed;
    },
    release,
  };
}

export function createGates(home: HermeticHome): OwnedGates {
  const root = resolve(home.root, GATES_DIRECTORY);
  const owned = new Map<string, OwnedGate>();

  return {
    root,
    gate(name) {
      if (!GATE_NAME.test(name)) {
        throw new Error(`a gate name is lowercase words: ${name}`);
      }
      const existing = owned.get(name);
      if (existing !== undefined) {
        return existing;
      }
      const created = createGate(root, name, owned.size);
      owned.set(name, created);
      return created;
    },
    async releaseAll() {
      await Promise.all([...owned.values()].map((gate) => gate.release()));
    },
  };
}

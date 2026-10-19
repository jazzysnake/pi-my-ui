import type { OwnedGates } from "./gate";

// Gates first: an unreleased gate holds a Pi child until the command's own bound, so teardown after
// a failed assertion must not wait on a run the test stopped caring about. Then the rest, in the
// order the test opened it.
export async function disposeHarnessInOrder(
  gates: OwnedGates,
  close: readonly (() => Promise<void>)[],
): Promise<void> {
  await gates.releaseAll();
  for (const step of close) {
    await step();
  }
}

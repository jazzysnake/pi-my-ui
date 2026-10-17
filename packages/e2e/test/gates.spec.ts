import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const HYGIENE_CHECK = fileURLToPath(new URL("../../../scripts/hygiene-check.mjs", import.meta.url));
const FIXTURE_CHECK = fileURLToPath(new URL("../../../scripts/fixture-check.mjs", import.meta.url));

function run(script: string, args: readonly string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

async function writeSource(root: string, comment: string): Promise<void> {
  await mkdir(join(root, "packages"), { recursive: true });
  await writeFile(
    join(root, "packages", "example.ts"),
    `export const value = 1;\n${comment}\nexport const other = 2;\n`,
    "utf8",
  );
}

test("the hygiene gate fails on a ticket or story reference and allows a decision record", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-my-ui-hygiene-"));
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeSource(root, "// Ticket 33 explains why this exists.");
    const ticket = run(HYGIENE_CHECK, ["--root", root]);
    expect(ticket.status).toBe(1);
    expect(ticket.stderr).toContain("Ticket 33");

    await writeSource(root, "// This follows story 78, not a ticket id.");
    const story = run(HYGIENE_CHECK, ["--root", root]);
    expect(story.status).toBe(1);
    expect(story.stderr).toContain("story 78");

    await writeSource(root, "// See ADR 0003 for the decision this encodes.");
    const decision = run(HYGIENE_CHECK, ["--root", root]);
    expect(decision.status).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the fixture gate fails loudly when git cannot list the staged files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-my-ui-fixtures-"));
  try {
    // A directory with no repository: git exits non-zero, and the gate must not report success
    // having inspected nothing.
    const result = run(FIXTURE_CHECK, ["--root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not list staged files");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

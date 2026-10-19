#!/usr/bin/env node
// Root `npm run verify` orchestrator. The fast gate stops after the build; `--full` adds the
// end-to-end suite as one process. A runner rather than an `&&` chain exists for the banner: every
// step prints its label before it starts, so a log says which step failed instead of burying the
// npm script name.

import { spawnSync } from "node:child_process";

/** A gate step: a human label and the root npm scripts it runs, in order. */
const STEPS = [
  { label: "typecheck (all packages, tests included)", scripts: ["typecheck"] },
  { label: "lint and format", scripts: ["lint", "format:check"] },
  { label: "store and component tests", scripts: ["test"] },
  { label: "build", scripts: ["build"] },
  { label: "end-to-end tests within the 45 s budget", scripts: ["test:e2e"], fullOnly: true },
];

/** npm is a shell script on POSIX and `npm.cmd` on Windows. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function runScript(script, position) {
  console.log(`[verify] ${position}: npm run ${script}`);
  const result = spawnSync(NPM, ["run", script], { stdio: "inherit" });

  if (result.error) {
    console.error(`[verify] FAILED at ${position}: could not start npm: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(
      `[verify] FAILED at ${position}: npm run ${script} terminated by ${result.signal}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[verify] FAILED at ${position}: npm run ${script} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const full = process.argv.includes("--full");
  const steps = full ? STEPS : STEPS.filter((step) => step.fullOnly !== true);
  const total = steps.length;

  console.log(
    full
      ? "[verify] full gate (end-to-end included)"
      : "[verify] fast gate (pass --full for end-to-end)",
  );

  for (let index = 0; index < total; index += 1) {
    const step = steps[index];
    const position = `step ${index + 1}/${total}`;
    console.log(`\n===== [verify] ${position}: ${step.label} =====`);
    for (const script of step.scripts) {
      runScript(script, position);
    }
  }

  console.log(`\n[verify] PASSED - all ${total} steps green.\n`);
}

main();

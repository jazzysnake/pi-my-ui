#!/usr/bin/env node
/** The `pi-my-ui` executable: one server for the current directory. */

import { runLauncher } from "./launcher/run.js";

process.exitCode = await runLauncher({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
});

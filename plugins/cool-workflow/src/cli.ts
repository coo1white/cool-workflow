#!/usr/bin/env node
import { runCli } from "./cli/command-surface";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cw: ${message}\n`);
  process.exitCode = 1;
});

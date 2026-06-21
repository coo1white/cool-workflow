#!/usr/bin/env node
import { runCli } from "./cli/command-surface";
import { red, bold } from "./term";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // Errors go to stderr → color must key off stderr (not the term default).
  process.stderr.write(`${bold("cw:", process.stderr)} ${red(message, process.stderr)}\n`);
  process.exitCode = 1;
});

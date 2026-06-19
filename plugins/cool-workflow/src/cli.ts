#!/usr/bin/env node
import { runCli } from "./cli/command-surface";
import { red, bold } from "./term";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${bold("cw:")} ${red(message)}\n`);
  process.exitCode = 1;
});

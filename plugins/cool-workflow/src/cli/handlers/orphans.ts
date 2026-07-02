// `cw orphans` handler — carved out of the command-surface god-dispatch. Orphan
// run sweep (gap found 2026-07-02): `list` inspects `.cw/runs/` directories the
// run registry cannot see (no state.json — a killed/interrupted process never
// wrote one); `gc` reclaims them (age-gated, or `--all`). See
// src/run-registry/orphans.ts for why this is orthogonal to `cw gc plan/run`.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { gcOrphanRuns, listOrphanRuns, runRegistryFor } from "../../capability-core";
import { formatOrphanRunsGc, formatOrphanRunsList } from "../../run-registry";
import { printJson, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home]
 *  [--min-age-minutes N] [--all] [--json]`. `--scope` defaults to `home`
 *  (every repo `cw` has registered, not just the current one) — same default as
 *  `cw gc plan|run`. */
export function handleOrphans(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const registry = runRegistryFor(args.options, runner);
  const [subcommand] = args.positionals;
  switch (subcommand) {
    case "list": {
      const result = listOrphanRuns(registry, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatOrphanRunsList(result)}\n`);
      return;
    }
    case "gc": {
      const result = gcOrphanRuns(registry, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatOrphanRunsGc(result)}\n`);
      return;
    }
    default:
      throw new Error(
        "Usage: cw.js orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] " +
          "[--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)"
      );
  }
}

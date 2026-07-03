// cli/dispatch.ts — the generic CLI executor over core/capability-table.ts.
//
// MILESTONE 2 (v2/PLAN.md build order, step 2; see the Revision note there
// for why this lands here, right after CLI parsing, instead of late).
//
// `dispatch(args)` first tries the CAPABILITY TABLE: it looks up the row
// whose `cli.path` matches the parsed command (+ enough leading
// positionals to disambiguate a subcommand, e.g. `sandbox list`), calls
// its `cli.handler`, and prints the `CliHandlerResult` per the row's
// `jsonMode`. This is the ONLY code path future milestones touch when
// they add a capability — as a table row, never a new switch arm here.
//
// Everything below `dispatchLegacy` is the milestone-1 carry-over: a
// small, explicitly-scoped switch for verbs that conformance/cases/
// cli-argv-parsing.case.js and cli-exit-codes.case.js probe but that do
// not yet have a real subsystem behind them (see each case's own
// PLACEHOLDER comment for which future milestone owns it). Per the
// Revision note in v2/PLAN.md, THIS file is never hand-extended again —
// `dispatchLegacy`'s arms shrink to nothing as later milestones move each
// one into a real capability-table row; nothing new is ever added here.

import * as fs from "node:fs";
import * as path from "node:path";
import { formatCommandHelp, formatHelp } from "../core/format/help";
import {
  CapabilityCliArgs,
  CliHandlerResult,
  CliJsonMode,
  findCapabilityByCliPath,
} from "../core/capability-table";
import { KNOWN_COMMANDS, ParsedArgv, suggestCommand } from "./parseargv";
import { optionalArg, printJson, required, wantsJson } from "./io";

/** Thrown errors carry only a message; the entry point decides exit code
 *  and the recovery hint, matching src/cli.ts's top-level catch. */
export type DispatchResult = void;

function firstPositional(args: ParsedArgv, index = 0): string | undefined {
  return args.positionals[index];
}

/** Writes a `CliHandlerResult` to stdout and applies its exit code, per
 *  the row's `jsonMode`:
 *   - `"default"` — always prints `result.json` as JSON (falls back to
 *     `result.text` when a row has no canonical JSON shape).
 *   - `"flag"` — prints `result.text` normally, `result.json` under
 *     `--json`/`--format json`.
 *   - `"human"` — always prints `result.text`; there is no JSON form. */
function renderCliResult(result: CliHandlerResult, jsonMode: CliJsonMode, options: Record<string, unknown>): void {
  const useJson = jsonMode === "default" || (jsonMode === "flag" && wantsJson(options));
  if (useJson && result.json !== undefined) {
    printJson(result.json);
  } else if (result.text !== undefined) {
    process.stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
  } else if (result.json !== undefined) {
    printJson(result.json);
  }
  if (result.exitCode !== undefined) process.exitCode = result.exitCode;
}

/** Tries the capability table for `args`. Matches the row whose
 *  `cli.path` is `[command]` or `[command, positionals[0]]` (the only two
 *  path lengths any milestone-2 row uses); returns true when a table row
 *  handled the command. */
function dispatchTable(args: ParsedArgv): boolean {
  const candidates: string[][] = [[args.command]];
  if (args.positionals.length > 0) candidates.push([args.command, args.positionals[0]]);

  for (const candidatePath of candidates.slice().reverse()) {
    const row = findCapabilityByCliPath(candidatePath);
    if (!row || !row.cli) continue;
    const consumed = candidatePath.length - 1; // path[0] is the command itself, already consumed
    const cliArgs: CapabilityCliArgs = {
      positionals: args.positionals.slice(consumed),
      options: args.options,
    };
    const result = row.cli.handler(cliArgs);
    renderCliResult(result, row.cli.jsonMode, args.options);
    return true;
  }
  return false;
}

// PLACEHOLDER (milestone 12, workflow-apps) — a tiny embedded id/title/
// summary list standing in for `runner.listApps()`. Real data lives in
// apps/*/app.json on disk; this milestone does not read that directory.
// Kept just large enough that `cw search app` and `cw search --` (a miss)
// are both observable, per cli-argv-parsing.case.js.
const PLACEHOLDER_APPS: Array<{ id: string; title: string; summary: string }> = [
  {
    id: "workflow-app-framework-demo",
    title: "Workflow App framework Demo",
    summary: "Small framework app showing inputs, phases, evidence gates, and sandbox profile hints.",
  },
];

function formatSearchResults(
  keyword: string,
  results: Array<{ id: string; title: string; summary: string }>
): string {
  if (results.length === 0) {
    return `No workflows matched "${keyword}".\n  Tip: cw list for all available workflows.`;
  }
  const lines: string[] = [`${results.length} workflow${results.length === 1 ? "" : "s"} matching "${keyword}"`];
  for (const r of results) {
    lines.push(`  ${r.id} — ${r.title}`);
    const cut = r.summary.length > 120 ? `${r.summary.slice(0, 119)}…` : r.summary;
    lines.push(`    ${cut}`);
  }
  lines.push("");
  lines.push("Use cw info <id> for full details.");
  return lines.join("\n");
}

/** The milestone-1 carry-over switch. See file header: never extended
 *  again — each arm here is replaced by a capability-table row when its
 *  own build-order milestone lands, not edited in place. */
function dispatchLegacy(args: ParsedArgv): void {
  switch (args.command) {
    case "": {
      process.stdout.write(formatHelp());
      return;
    }
    case "help": {
      const topic = firstPositional(args);
      if (topic) {
        process.stdout.write(formatCommandHelp(topic, suggestCommand));
      } else {
        process.stdout.write(formatHelp());
      }
      return;
    }
    // NOTE: "version" is not an arm here — it is a real capability-table
    // row (core/capability-table.ts) that dispatchTable() above always
    // matches first, per the Revision note's "table rows, never a new
    // switch arm" rule. Same for "list", "status", and "sandbox list".

    // PLACEHOLDER (milestone 12, workflow-apps) — real search filters
    // runner.listApps() by title/summary/id; see note above.
    case "search": {
      const keyword = args.positionals.join(" ");
      if (!keyword.trim()) {
        throw new Error(
          'Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.'
        );
      }
      const lower = keyword.toLowerCase();
      const results = PLACEHOLDER_APPS.filter(
        (a) =>
          a.title.toLowerCase().includes(lower) ||
          a.summary.toLowerCase().includes(lower) ||
          a.id.toLowerCase().includes(lower)
      );
      if (wantsJson(args.options)) {
        printJson(results);
      } else {
        process.stdout.write(`${formatSearchResults(keyword, results)}\n`);
      }
      return;
    }

    // PLACEHOLDER (milestone 3, state kernel) — real `plan` creates a run
    // dir + state.json; this milestone only reproduces the missing-id
    // refusal that cli-exit-codes.case.js probes.
    case "plan": {
      const workflowId = optionalArg(firstPositional(args));
      if (!workflowId) {
        throw new Error('Missing workflow id.\n  Tip: plan an architecture review with "cw plan architecture-review"');
      }
      throw new Error("plan is not implemented in this milestone");
    }

    // PLACEHOLDER (milestone 3, state kernel) — real `quickstart` plans,
    // drives, and reports in one call; this milestone only reproduces the
    // fail-closed shape when the resolved repo path does not exist (the
    // run-dir mkdir fails with the same ENOENT node's fs gives on the real
    // pipeline's first disk write), so the `-dir`/`--repo` precedence rule
    // is observable through a real error message naming the resolved path.
    case "quickstart": {
      const repo = optionalArg(args.options.repo) || process.cwd();
      const resolvedRepo = path.resolve(repo);
      fs.mkdirSync(path.join(resolvedRepo, ".cw", "runs"), { recursive: true });
      throw new Error("quickstart is not implemented in this milestone");
    }

    // PLACEHOLDER (milestone 3/6, state kernel + pipeline) — real `next`
    // loads run state and returns dispatchable tasks; this milestone only
    // reproduces the io.required missing-run-id refusal.
    case "next": {
      const runId = required(optionalArg(firstPositional(args)), "run id");
      throw new Error(`next is not implemented in this milestone (runId=${runId})`);
    }

    // PLACEHOLDER (milestone 8, trust/ledger) — real `ledger list` reads +
    // verifies every entry against its content digest (core/trust/
    // ledger.ts's verifyLedgerEntry). This milestone only reproduces the
    // observable dir/dirs/count envelope shape that cli-argv-parsing.
    // case.js probes (repeated --dir becomes an array), reading each
    // *.json file in the given director{y,ies} WITHOUT real digest
    // verification. NOTE: "ledger" is intentionally absent from
    // KNOWN_COMMANDS (see cli/parseargv.ts) even though the dispatcher
    // handles it here — a known, preserved wart, not a bug.
    case "ledger": {
      const sub = firstPositional(args);
      if (sub === "list") {
        const dirOption = args.options.dir;
        const dirs = Array.isArray(dirOption) ? dirOption.map(String) : dirOption !== undefined ? [String(dirOption)] : [];
        const readDir = (dir: string) => {
          let names: string[] = [];
          try {
            names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
          } catch {
            return [] as Array<Record<string, unknown>>;
          }
          return names.map((name) => {
            try {
              const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
              return { file: name, id: raw.id ?? null, kind: raw.kind ?? null, ok: false };
            } catch {
              return { file: name, id: null, kind: null, ok: false };
            }
          });
        };
        const payload: Record<string, unknown> =
          dirs.length >= 2
            ? { dirs, count: dirs.length, allOk: false, entries: dirs.flatMap(readDir) }
            : { dir: dirs[0], count: dirs.length, allOk: false, entries: dirs.length ? readDir(dirs[0]) : [] };
        printJson(payload);
        process.exitCode = 1;
        return;
      }
      throw new Error(`ledger ${sub ?? ""} is not implemented in this milestone`);
    }

    // PLACEHOLDER (milestone 10, scheduling/gc) — real `gc verify` checks
    // whether a run's disk footprint was actually reclaimed; a run that
    // was never reclaimed is not a failure (exit 0), which is exactly the
    // shape this stub reproduces for an unresolvable run id.
    case "gc": {
      const sub = firstPositional(args);
      if (sub === "verify") {
        const runId = optionalArg(firstPositional(args, 1));
        const payload = {
          schemaVersion: 1,
          runId: runId ?? null,
          reclaimed: false,
          verified: false,
          tier: "live",
          capability: "re-runnable",
          chainLength: 0,
          checks: [{ name: "located", pass: false, code: "not-reclaimed", detail: "run source not found" }],
          nextAction: "node scripts/cw.js registry refresh --scope home",
        };
        printJson(payload);
        return;
      }
      throw new Error(`gc ${sub ?? ""} is not implemented in this milestone`);
    }

    // PLACEHOLDER (milestone 11, reporting/run-export) — real
    // inspect-archive/restore read a portable archive's manifest and
    // verify digests; this milestone reproduces only the fail-closed
    // "archive not found" shape.
    case "run": {
      const sub = firstPositional(args);
      if (sub === "inspect-archive") {
        const archivePath = optionalArg(firstPositional(args, 1)) || "";
        const payload = {
          schemaVersion: 1,
          archivePath,
          ok: false,
          schemaSupported: false,
          runId: null,
          fileCount: 0,
          manifestSha256: null,
          archiveSha256: null,
          checks: [{ name: "archive", pass: false, code: "archive-unreadable", path: archivePath }],
        };
        printJson(payload);
        process.exitCode = 1;
        return;
      }
      if (sub === "restore") {
        const archivePath = optionalArg(firstPositional(args, 1)) || "";
        const payload = {
          schemaVersion: 1,
          ok: false,
          target: archivePath,
          inspect: {
            schemaVersion: 1,
            archivePath,
            ok: false,
            schemaSupported: false,
            runId: null,
            fileCount: 0,
            manifestSha256: null,
            archiveSha256: null,
            checks: [{ name: "archive", pass: false, code: "archive-unreadable", path: archivePath }],
          },
          imported: null,
          verify: null,
          registry: null,
        };
        printJson(payload);
        process.exitCode = 1;
        return;
      }
      throw new Error(`run ${sub ?? ""} is not implemented in this milestone`);
    }

    // PLACEHOLDER (milestone 5, execution backend/sandbox) — real
    // `sandbox validate` reads a sandbox profile file and checks its
    // shape; this milestone reproduces only the file-not-found refusal.
    // (`sandbox list` is handled above by dispatchTable — a real
    // capability-table row — before this switch is ever reached.)
    case "sandbox": {
      const sub = firstPositional(args);
      if (sub === "validate") {
        const profileFile = optionalArg(firstPositional(args, 1)) || "";
        const payload = {
          valid: false,
          profileFile,
          issues: [
            {
              code: "sandbox-profile-invalid",
              message: `Profile file does not exist: ${profileFile}`,
              path: profileFile,
            },
          ],
        };
        printJson(payload);
        process.exitCode = 1;
        return;
      }
      throw new Error(`sandbox ${sub ?? ""} is not implemented in this milestone`);
    }

    // PLACEHOLDER (milestone 9, multi-agent/topology) — real
    // `topology validate` checks a topology id against the registered
    // OFFICIAL_TOPOLOGIES table; this milestone reproduces only the
    // unknown-id refusal.
    case "topology": {
      const sub = firstPositional(args);
      if (sub === "validate") {
        const topologyId = optionalArg(firstPositional(args, 1)) || "";
        const payload = {
          valid: false,
          topologyId,
          issues: [{ code: "unknown-topology", message: `Unknown topology id: ${topologyId}` }],
        };
        printJson(payload);
        process.exitCode = 1;
        return;
      }
      throw new Error(`topology ${sub ?? ""} is not implemented in this milestone`);
    }

    // PLACEHOLDER (milestone 3/4, state kernel + contract-migration) —
    // real `migration check`/`prove` resolve a run id or file target; the
    // missing-target refusal is the only shape this milestone reproduces.
    case "migration": {
      const sub = firstPositional(args);
      if (sub === "check" || sub === "prove") {
        const target = optionalArg(firstPositional(args, 1));
        if (!target) {
          throw new Error(
            'Missing target (run-id or state/app file).\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"'
          );
        }
        throw new Error(`migration ${sub} is not implemented in this milestone`);
      }
      throw new Error(`migration ${sub ?? ""} is not implemented in this milestone`);
    }

    // PLACEHOLDER (milestone 11, reporting/run-export) — real
    // `report verify-bundle` verifies a sealed bundle's telemetry/trust
    // chain offline; this milestone reproduces only the archive-not-found
    // refusal.
    case "report": {
      const sub = firstPositional(args);
      if (sub === "verify-bundle") {
        const archivePath = optionalArg(firstPositional(args, 1)) || "";
        const payload = {
          schemaVersion: 1,
          archivePath,
          runId: null,
          ok: false,
          archiveOk: false,
          telemetryVerified: false,
          trustAuditVerified: false,
          trustKeySource: "none",
          signatureKeyProvided: false,
          signaturesChecked: 0,
          signaturesReverified: 0,
          signaturesFailed: 0,
          trustLevel: "unsigned",
          reportFindingsVerified: false,
          failedChecks: [{ name: "archive", code: "archive-unreadable" }],
        };
        printJson(payload);
        process.exitCode = 1;
        return;
      }
      throw new Error(`report ${sub ?? ""} is not implemented in this milestone`);
    }

    default: {
      const hint = suggestCommand(args.command);
      const tail = hint ? `. Did you mean: ${hint}?` : "";
      throw new Error(`Unknown command: ${args.command}${tail}`);
    }
  }
}

/** Runs one parsed command. Throws on any recoverable failure (the entry
 *  point's top-level catch turns that into the `cw: <message>` stderr
 *  shape + exit 1); sets `process.exitCode = 1` directly for the
 *  fail-closed-but-clean-JSON verbs (never a hard `process.exit`).
 *
 *  Tries the capability table FIRST (real rows always win), then falls
 *  back to the milestone-1 legacy switch for verbs not yet migrated. */
export function dispatch(args: ParsedArgv): DispatchResult {
  if (dispatchTable(args)) return;
  dispatchLegacy(args);
}

/** Re-exported so cli/entry.ts (and tests) can check membership without a
 *  second import path. */
export { KNOWN_COMMANDS };

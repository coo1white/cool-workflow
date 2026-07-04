"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_COMMANDS = void 0;
exports.dispatch = dispatch;
const help_1 = require("../core/format/help");
const capability_table_1 = require("../core/capability-table");
const parseargv_1 = require("./parseargv");
Object.defineProperty(exports, "KNOWN_COMMANDS", { enumerable: true, get: function () { return parseargv_1.KNOWN_COMMANDS; } });
const io_1 = require("./io");
const workflow_app_loader_1 = require("../shell/workflow-app-loader");
function firstPositional(args, index = 0) {
    return args.positionals[index];
}
/** Writes a `CliHandlerResult` to stdout and applies its exit code, per
 *  the row's `jsonMode`:
 *   - `"default"` — always prints `result.json` as JSON (falls back to
 *     `result.text` when a row has no canonical JSON shape).
 *   - `"flag"` — prints `result.text` normally, `result.json` under
 *     `--json`/`--format json`.
 *   - `"human"` — always prints `result.text`; there is no JSON form. */
function renderCliResult(result, jsonMode, options) {
    const useJson = jsonMode === "default" || (jsonMode === "flag" && (0, io_1.wantsJson)(options));
    if (useJson && result.json !== undefined) {
        (0, io_1.printJson)(result.json);
    }
    else if (result.text !== undefined) {
        process.stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
    }
    else if (result.json !== undefined) {
        (0, io_1.printJson)(result.json);
    }
    if (result.exitCode !== undefined)
        process.exitCode = result.exitCode;
}
/** Tries the capability table for `args`. Matches the row whose
 *  `cli.path` is `[command]` or `[command, positionals[0]]` (the only two
 *  path lengths any milestone-2 row uses); returns true when a table row
 *  handled the command. */
function dispatchTable(args) {
    const candidates = [[args.command]];
    if (args.positionals.length > 0)
        candidates.push([args.command, args.positionals[0]]);
    for (const candidatePath of candidates.slice().reverse()) {
        const row = (0, capability_table_1.findCapabilityByCliPath)(candidatePath);
        if (!row || !row.cli)
            continue;
        const consumed = candidatePath.length - 1; // path[0] is the command itself, already consumed
        const cliArgs = {
            positionals: args.positionals.slice(consumed),
            options: args.options,
        };
        const result = row.cli.handler(cliArgs);
        renderCliResult(result, row.cli.jsonMode, args.options);
        return true;
    }
    return false;
}
// MILESTONE 12 (workflow-apps) — `search` filters the SAME real app
// discovery `cw app list`/`cw list` use (shell/workflow-app-loader.ts),
// by id/title/summary, matching `listApps` in the old build.
function formatSearchResults(keyword, results) {
    if (results.length === 0) {
        return `No workflows matched "${keyword}".\n  Tip: cw list for all available workflows.`;
    }
    const lines = [`${results.length} workflow${results.length === 1 ? "" : "s"} matching "${keyword}"`];
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
function dispatchLegacy(args) {
    switch (args.command) {
        case "": {
            process.stdout.write((0, io_1.styledHelp)());
            return;
        }
        case "help": {
            const topic = firstPositional(args);
            if (topic) {
                process.stdout.write((0, help_1.formatCommandHelp)(topic, parseargv_1.suggestCommand));
            }
            else {
                process.stdout.write((0, io_1.styledHelp)());
            }
            return;
        }
        // NOTE: "version" is not an arm here — it is a real capability-table
        // row (core/capability-table.ts) that dispatchTable() above always
        // matches first, per the Revision note's "table rows, never a new
        // switch arm" rule. Same for "list", "status", and "sandbox list".
        // `search` filters the real app discovery by title/summary/id (see
        // note above); MILESTONE 12.
        case "search": {
            const keyword = args.positionals.join(" ");
            if (!keyword.trim()) {
                throw new Error('Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.');
            }
            const lower = keyword.toLowerCase();
            const results = (0, workflow_app_loader_1.listWorkflowApps)()
                .filter((a) => String(a.title).toLowerCase().includes(lower) ||
                String(a.summary).toLowerCase().includes(lower) ||
                String(a.id).toLowerCase().includes(lower))
                .map((a) => ({ id: String(a.id), title: String(a.title), summary: String(a.summary) }));
            if ((0, io_1.wantsJson)(args.options)) {
                (0, io_1.printJson)(results);
            }
            else {
                process.stdout.write(`${formatSearchResults(keyword, results)}\n`);
            }
            return;
        }
        // NOTE: "plan" and "quickstart" are not arms here any more — both are
        // now real capability-table rows (core/capability-table.ts, milestone
        // 6+7) that dispatchTable() above always matches first.
        // PLACEHOLDER (milestone 3/6, state kernel + pipeline) — real `next`
        // loads run state and returns dispatchable tasks; this milestone only
        // reproduces the io.required missing-run-id refusal.
        case "next": {
            const runId = (0, io_1.required)((0, io_1.optionalArg)(firstPositional(args)), "run id");
            throw new Error(`next is not implemented in this milestone (runId=${runId})`);
        }
        // MILESTONE 8 — `ledger propose|review|verify|apply|list` are now
        // real capability-table rows (core/capability-table.ts) that
        // dispatchTable() above always matches first; this arm is reached
        // only for an unrecognized subcommand (byte-exact to the old
        // build's handleLedger default case). NOTE: "ledger" is
        // intentionally absent from KNOWN_COMMANDS (see cli/parseargv.ts)
        // even though the dispatcher handles it here — a known, preserved
        // wart, not a bug.
        case "ledger": {
            throw new Error("Usage: cw ledger propose|review|verify|apply|list [options]");
        }
        // PLACEHOLDER (milestone 10, scheduling/gc) — real `gc verify` checks
        // whether a run's disk footprint was actually reclaimed; a run that
        // was never reclaimed is not a failure (exit 0), which is exactly the
        // shape this stub reproduces for an unresolvable run id.
        case "gc": {
            const sub = firstPositional(args);
            if (sub === "verify") {
                const runId = (0, io_1.optionalArg)(firstPositional(args, 1));
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
                (0, io_1.printJson)(payload);
                return;
            }
            throw new Error(`gc ${sub ?? ""} is not implemented in this milestone`);
        }
        // NOTE: "run" is not an arm here any more — run.drive.step/run.drive
        // are now real capability-table rows (core/capability-table.ts,
        // milestone 6+7) that dispatchTable() above always matches first
        // (their handler reproduces the inspect-archive/restore placeholder
        // shapes this arm used to own), per the Revision note's "table rows,
        // never a new switch arm" rule.
        // NOTE: "sandbox" is not an arm here — sandbox.list/show/validate are
        // now real capability-table rows (core/capability-table.ts, milestone
        // 5) that dispatchTable() above always matches first, per the
        // Revision note's "table rows, never a new switch arm" rule.
        // NOTE: "topology" is not an arm here any more — topology.list/show/
        // validate/apply/summary/graph are now real capability-table rows
        // (core/capability-table.ts, milestone 9) that dispatchTable() above
        // always matches first, per the Revision note's "table rows, never a
        // new switch arm" rule.
        // PLACEHOLDER (milestone 3/4, state kernel + contract-migration) —
        // real `migration check`/`prove` resolve a run id or file target; the
        // missing-target refusal is the only shape this milestone reproduces.
        case "migration": {
            const sub = firstPositional(args);
            if (sub === "check" || sub === "prove") {
                const target = (0, io_1.optionalArg)(firstPositional(args, 1));
                if (!target) {
                    throw new Error('Missing target (run-id or state/app file).\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"');
                }
                throw new Error(`migration ${sub} is not implemented in this milestone`);
            }
            throw new Error(`migration ${sub ?? ""} is not implemented in this milestone`);
        }
        // NOTE: "report" is not an arm here any more — report/report.bundle/
        // report.verify-bundle are now real capability-table rows
        // (core/capability-table.ts, milestones 8/11) that dispatchTable()
        // above always matches first, per the Revision note's "table rows,
        // never a new switch arm" rule.
        default: {
            const hint = (0, parseargv_1.suggestCommand)(args.command);
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
function dispatch(args) {
    if (dispatchTable(args))
        return;
    dispatchLegacy(args);
}
